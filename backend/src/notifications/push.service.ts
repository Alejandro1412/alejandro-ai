import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { z } from 'zod';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { pushSubscriptions } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { BusinessRuleError } from '../common/errors/app-error';

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/**
 * Web Push (VAPID) for staff devices: new handoffs, bookings and low reviews reach reception even when
 * the dashboard tab is closed. Disabled (no-op) until VAPID keys are configured.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  readonly enabled: boolean;

  constructor(@Inject(DB) private readonly db: Database) {
    const e = env();
    this.enabled = Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
    if (this.enabled) webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
  }

  publicKey() {
    return { enabled: this.enabled, publicKey: this.enabled ? env().VAPID_PUBLIC_KEY! : null };
  }

  async subscribe(userId: string, sub: z.infer<typeof pushSubscriptionSchema>, userAgent?: string) {
    if (!this.enabled) throw new BusinessRuleError('PUSH_DISABLED', 'Push notifications are not configured on this server');
    const values = { organizationId: TenantContext.orgId(), userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null };
    await this.db.insert(pushSubscriptions).values(values).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
    return { subscribed: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    return { subscribed: false };
  }

  /** Best effort; expired subscriptions (404/410) are pruned. */
  async sendToUsers(userIds: string[], payload: { title: string; body: string; url?: string; tag?: string }) {
    if (!this.enabled || !userIds.length) return 0;
    const subs = await this.db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.organizationId, TenantContext.orgId()), inArray(pushSubscriptions.userId, userIds)));
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, timeout: 5000 });
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
          else this.logger.warn(`Push to ${s.endpoint.slice(0, 40)}… failed: ${(err as Error).message}`);
        }
      }),
    );
    return sent;
  }
}
