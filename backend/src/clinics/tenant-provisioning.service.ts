import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DbExecutor } from '../database/database.module';
import { agents, clinics, organizations } from '../database/schema';
import {
  DEFAULT_BOOKING_RULES,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_HANDOFF_RULES,
  DEFAULT_NOTIFICATION_RULES,
} from '../ai/agent-defaults';
import { BillingService } from '../billing/billing.service';

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'clinic';

/** Creates a complete tenant (organization + clinic + default agent + trial subscription) atomically. */
@Injectable()
export class TenantProvisioningService {
  constructor(private readonly billing: BillingService) {}

  async provision(
    tx: DbExecutor,
    input: { organizationName: string; clinicName: string; timezone: string; locale: 'es' | 'en'; planKey: string },
  ) {
    const suffix = randomBytes(3).toString('hex');
    const [organization] = await tx
      .insert(organizations)
      .values({ name: input.organizationName, slug: `${slugify(input.organizationName)}-${suffix}` })
      .returning();
    const [clinic] = await tx
      .insert(clinics)
      .values({
        organizationId: organization.id,
        name: input.clinicName,
        slug: `${slugify(input.clinicName)}-${suffix}`,
        timezone: input.timezone,
        locale: input.locale,
        businessHours: {
          mon: [['08:00', '18:00']],
          tue: [['08:00', '18:00']],
          wed: [['08:00', '18:00']],
          thu: [['08:00', '18:00']],
          fri: [['08:00', '18:00']],
          sat: [['08:00', '12:00']],
        },
      })
      .returning();
    await tx.insert(agents).values({
      organizationId: organization.id,
      clinicId: clinic.id,
      handoffRules: DEFAULT_HANDOFF_RULES,
      bookingRules: DEFAULT_BOOKING_RULES,
      notificationRules: DEFAULT_NOTIFICATION_RULES,
      cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
    });
    await this.billing.startTrial(tx, organization.id, input.planKey);
    return { organization, clinic };
  }
}
