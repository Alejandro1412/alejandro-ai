import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env';
import { Database, DB } from '../../database/database.module';
import { clinics, whatsappChannels } from '../../database/schema';
import { TenantContext, withTenant } from '../../database/tenant';
import { ConflictError } from '../../common/errors/app-error';
import { decryptSecret, encryptSecret } from '../../common/utils/crypto';
import { AuditService } from '../../audit/audit.service';
import { ChannelProviders, MetaWhatsAppProvider, type WhatsAppProvider } from './channel-providers';

export const whatsappChannelSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,30}$/, 'Phone number ID is numeric (Meta → WhatsApp → API setup)'),
  displayPhoneNumber: z.string().trim().max(30).nullable().optional(),
  wabaId: z.string().trim().regex(/^\d{6,30}$/).nullable().optional(),
  /** Permanent system-user token. Omit to keep the stored one; send null to use the platform token. */
  accessToken: z.string().trim().min(20).max(1000).nullable().optional(),
});

/**
 * Multi-tenant WhatsApp: each clinic connects its own WhatsApp Business number. Inbound webhooks are
 * routed to the clinic by `metadata.phone_number_id`; outbound messages use that clinic's number and
 * token (encrypted at rest). Without a per-clinic channel the platform number from the environment is used.
 */
@Injectable()
export class WhatsAppChannelsService {
  private readonly cache = new Map<string, WhatsAppProvider>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly channels: ChannelProviders,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const [row] = await this.db.select().from(whatsappChannels).where(eq(whatsappChannels.clinicId, TenantContext.clinicId()));
    if (!row || row.organizationId !== TenantContext.orgId()) return null;
    return { id: row.id, phoneNumberId: row.phoneNumberId, displayPhoneNumber: row.displayPhoneNumber, wabaId: row.wabaId, hasOwnToken: Boolean(row.accessTokenEncrypted), status: row.status, updatedAt: row.updatedAt };
  }

  async upsert(dto: z.infer<typeof whatsappChannelSchema>) {
    const clinicId = TenantContext.clinicId();
    const [taken] = await this.db.select({ clinicId: whatsappChannels.clinicId }).from(whatsappChannels).where(eq(whatsappChannels.phoneNumberId, dto.phoneNumberId));
    if (taken && taken.clinicId !== clinicId) throw new ConflictError('WHATSAPP_NUMBER_IN_USE', 'This WhatsApp number is already connected to another clinic');
    const tokenPatch = dto.accessToken === undefined ? {} : { accessTokenEncrypted: dto.accessToken ? encryptSecret(dto.accessToken) : null };
    const values = withTenant({ clinicId, phoneNumberId: dto.phoneNumberId, displayPhoneNumber: dto.displayPhoneNumber ?? null, wabaId: dto.wabaId ?? null, status: 'ACTIVE', ...tokenPatch });
    await this.db
      .insert(whatsappChannels)
      .values(values)
      .onConflictDoUpdate({ target: whatsappChannels.clinicId, set: { ...values, updatedAt: new Date() } });
    this.cache.delete(clinicId);
    await this.audit.log({ action: 'whatsapp.channel_updated', entityType: 'WhatsAppChannel', metadata: { phoneNumberId: `…${dto.phoneNumberId.slice(-4)}`, ownToken: Boolean(dto.accessToken) } });
    return this.get();
  }

  async remove() {
    await this.db.delete(whatsappChannels).where(eq(whatsappChannels.clinicId, TenantContext.clinicId()));
    this.cache.delete(TenantContext.clinicId());
    await this.audit.log({ action: 'whatsapp.channel_updated', entityType: 'WhatsAppChannel', metadata: { removed: true } });
    return { removed: true };
  }

  /** Clinic for an inbound webhook (no tenant context yet). Falls back to WHATSAPP_DEFAULT_CLINIC_SLUG for single-number setups. */
  async resolveClinic(phoneNumberId: string | null) {
    if (phoneNumberId) {
      const [row] = await this.db
        .select({ clinic: clinics })
        .from(whatsappChannels)
        .innerJoin(clinics, eq(clinics.id, whatsappChannels.clinicId))
        .where(eq(whatsappChannels.phoneNumberId, phoneNumberId));
      if (row) return row.clinic;
      // A number registered to no clinic must not fall through to an arbitrary tenant.
      if (env().WHATSAPP_PHONE_NUMBER_ID && phoneNumberId !== env().WHATSAPP_PHONE_NUMBER_ID) return null;
    }
    const slug = env().WHATSAPP_DEFAULT_CLINIC_SLUG;
    const [row] = slug ? await this.db.select().from(clinics).where(eq(clinics.slug, slug)) : await this.db.select().from(clinics).limit(1);
    return row ?? null;
  }

  /** Outbound provider for the current clinic. */
  async provider(): Promise<WhatsAppProvider> {
    const clinicId = TenantContext.current()?.clinicId;
    if (!clinicId || this.channels.whatsapp.name === 'mock') return this.channels.whatsapp;
    const cached = this.cache.get(clinicId);
    if (cached) return cached;
    const [row] = await this.db.select().from(whatsappChannels).where(eq(whatsappChannels.clinicId, clinicId));
    const token = row?.accessTokenEncrypted ? decryptSecret(row.accessTokenEncrypted) : env().WHATSAPP_TOKEN;
    const provider = row && token ? new MetaWhatsAppProvider(token, row.phoneNumberId, env().WHATSAPP_APP_SECRET) : this.channels.whatsapp;
    this.cache.set(clinicId, provider);
    return provider;
  }
}
