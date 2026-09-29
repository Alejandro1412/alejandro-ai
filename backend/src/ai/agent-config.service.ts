import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { agents, clinics, doctors, services, specialties } from '../database/schema';
import { TenantContext, tenantScope } from '../database/tenant';
import { NotFoundError, ValidationError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../jobs/cache.service';
import type { AgentConfig } from './agent-config';
import { updateAgentConfigSchema } from './agent-config';
import type { Catalog } from './policy/intent-classifier';
import { SUPPORTED_MODELS } from './llm/pricing';

@Injectable()
export class AgentConfigService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async get(): Promise<AgentConfig> {
    const [row] = await this.db.select().from(agents).where(tenantScope(agents, eq(agents.clinicId, TenantContext.clinicId())));
    if (!row) throw new NotFoundError('Agent');
    return row;
  }

  async update(patch: z.infer<typeof updateAgentConfigSchema>): Promise<AgentConfig> {
    const current = await this.get();
    const provider = patch.provider ?? current.provider;
    const model = patch.model ?? (patch.provider ? SUPPORTED_MODELS[provider as keyof typeof SUPPORTED_MODELS][0] : current.model);
    if (!SUPPORTED_MODELS[provider as keyof typeof SUPPORTED_MODELS]?.includes(model)) throw new ValidationError(`Model ${model} is not supported for provider ${provider}`);
    const [row] = await this.db
      .update(agents)
      .set({ ...patch, provider, model })
      .where(tenantScope(agents, eq(agents.id, current.id)))
      .returning();
    await this.audit.log({ action: 'settings.ai_updated', entityType: 'Agent', entityId: row.id, metadata: { fields: Object.keys(patch) } });
    return row;
  }

  async clinic() {
    const [c] = await this.db.select().from(clinics).where(tenantScope(clinics, eq(clinics.id, TenantContext.clinicId())));
    if (!c) throw new NotFoundError('Clinic');
    return c;
  }

  /** Clinic vocabulary used for entity extraction (cached briefly; invalidated on writes by TTL). */
  async catalog(): Promise<Catalog> {
    const clinicId = TenantContext.clinicId();
    return this.cache.wrap(`clinic:${clinicId}:catalog`, 60, async () => {
      const [sp, docs, svcs] = await Promise.all([
        this.db.select().from(specialties).where(tenantScope(specialties, eq(specialties.clinicId, clinicId))).orderBy(asc(specialties.name)),
        this.db.select().from(doctors).where(tenantScope(doctors, eq(doctors.clinicId, clinicId), eq(doctors.status, 'ACTIVE'))),
        this.db.select().from(services).where(tenantScope(services, eq(services.clinicId, clinicId), eq(services.isActive, true))),
      ]);
      return {
        specialties: sp.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn, keywords: s.keywords })),
        doctors: docs.map((d) => ({ id: d.id, firstName: d.firstName, lastName: d.lastName, specialtyId: d.specialtyId })),
        services: svcs.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn })),
      };
    });
  }
}
