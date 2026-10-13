import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { actionTokens } from '../database/schema';
import { TenantContext, withTenant } from '../database/tenant';
import { AppError, NotFoundError } from '../common/errors/app-error';
import { randomToken, sha256 } from '../common/utils/crypto';

export type ActionPurpose = 'confirm' | 'cancel' | 'waitlist' | 'intake' | 'review' | 'payment';

/** Default lifetime of each kind of link. */
const TTL_HOURS: Record<ActionPurpose, number> = {
  confirm: 24 * 14,
  cancel: 24 * 14,
  waitlist: 2,
  intake: 24 * 30,
  review: 24 * 14,
  payment: 24,
};

export class ActionTokenError extends AppError {
  constructor(code: 'ACTION_LINK_EXPIRED' | 'ACTION_LINK_USED', message: string) {
    super(410, code, message);
  }
}

export interface IssuedToken {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * Signed links for patients who are not logged in. The raw token (256 bits) only ever travels in the
 * link; the database keeps its SHA-256, so a database leak cannot be replayed. Links are scoped to one
 * tenant + purpose + payload, expire, and most are single-use (enforced atomically on consume).
 */
@Injectable()
export class ActionTokensService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async issue(purpose: ActionPurpose, payload: Record<string, unknown>, opts: { ttlHours?: number; expiresAt?: Date } = {}): Promise<IssuedToken> {
    const token = randomToken(32);
    const expiresAt = opts.expiresAt ?? new Date(Date.now() + (opts.ttlHours ?? TTL_HOURS[purpose]) * 3_600_000);
    await this.db.insert(actionTokens).values(withTenant({ clinicId: TenantContext.clinicId(), tokenHash: sha256(token), purpose, payload, expiresAt }));
    return { token, url: ActionTokensService.url(token), expiresAt };
  }

  static url(token: string): string {
    return `${env().APP_URL.replace(/\/$/, '')}/a/${token}`;
  }

  /** Looks a token up WITHOUT tenant context (the link is the credential). Throws 404 / 410. */
  async peek(token: string) {
    if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) throw new NotFoundError('Link');
    const [row] = await this.db.select().from(actionTokens).where(eq(actionTokens.tokenHash, sha256(token)));
    if (!row) throw new NotFoundError('Link');
    if (row.usedAt) throw new ActionTokenError('ACTION_LINK_USED', 'This link was already used');
    if (row.expiresAt.getTime() < Date.now()) throw new ActionTokenError('ACTION_LINK_EXPIRED', 'This link has expired');
    return row;
  }

  /** Marks the token used; returns false if another request consumed it first (exactly-once). */
  async consume(id: string): Promise<boolean> {
    const rows = await this.db
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(actionTokens.id, id), isNull(actionTokens.usedAt), gt(actionTokens.expiresAt, new Date())))
      .returning({ id: actionTokens.id });
    return rows.length === 1;
  }
}
