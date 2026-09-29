import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { clinics, locations, services, specialties } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../jobs/cache.service';
import { slugify } from './tenant-provisioning.service';
import { locationSchema, serviceSchema, specialtySchema, updateClinicSchema } from './clinics.schemas';

@Injectable()
export class ClinicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  // ── Clinic ──
  async listClinics() {
    return this.db.select().from(clinics).where(tenantScope(clinics)).orderBy(asc(clinics.name));
  }

  async current() {
    const [clinic] = await this.db.select().from(clinics).where(tenantScope(clinics, eq(clinics.id, TenantContext.clinicId())));
    if (!clinic) throw new NotFoundError('Clinic');
    return clinic;
  }

  async update(patch: z.infer<typeof updateClinicSchema>) {
    const [clinic] = await this.db
      .update(clinics)
      .set(patch)
      .where(tenantScope(clinics, eq(clinics.id, TenantContext.clinicId())))
      .returning();
    await this.audit.log({ action: 'settings.clinic_updated', entityType: 'Clinic', entityId: clinic.id, metadata: { fields: Object.keys(patch) } });
    await this.cache.del(`clinic:${clinic.id}:*`);
    return clinic;
  }

  async completeOnboarding() {
    const [clinic] = await this.db
      .update(clinics)
      .set({ onboardedAt: new Date() })
      .where(tenantScope(clinics, eq(clinics.id, TenantContext.clinicId())))
      .returning();
    return clinic;
  }

  // ── Locations ──
  listLocations() {
    return this.db.select().from(locations).where(tenantScope(locations, eq(locations.clinicId, TenantContext.clinicId()))).orderBy(asc(locations.name));
  }
  async createLocation(dto: z.infer<typeof locationSchema>) {
    const [row] = await this.db.insert(locations).values(withTenant({ ...dto, clinicId: TenantContext.clinicId() })).returning();
    return row;
  }
  async updateLocation(id: string, dto: Partial<z.infer<typeof locationSchema>>) {
    const [row] = await this.db.update(locations).set(dto).where(tenantScope(locations, eq(locations.id, id))).returning();
    if (!row) throw new NotFoundError('Location', id);
    return row;
  }
  async deleteLocation(id: string) {
    const [row] = await this.db.delete(locations).where(tenantScope(locations, eq(locations.id, id))).returning();
    if (!row) throw new NotFoundError('Location', id);
    return { id };
  }

  // ── Specialties ──
  listSpecialties() {
    return this.db
      .select()
      .from(specialties)
      .where(tenantScope(specialties, eq(specialties.clinicId, TenantContext.clinicId())))
      .orderBy(asc(specialties.name));
  }
  async createSpecialty(dto: z.infer<typeof specialtySchema>) {
    const [row] = await this.db
      .insert(specialties)
      .values(withTenant({ ...dto, slug: slugify(dto.name), clinicId: TenantContext.clinicId() }))
      .returning();
    return row;
  }
  async updateSpecialty(id: string, dto: Partial<z.infer<typeof specialtySchema>>) {
    const [row] = await this.db
      .update(specialties)
      .set({ ...dto, ...(dto.name ? { slug: slugify(dto.name) } : {}) })
      .where(tenantScope(specialties, eq(specialties.id, id)))
      .returning();
    if (!row) throw new NotFoundError('Specialty', id);
    return row;
  }
  async deleteSpecialty(id: string) {
    const [row] = await this.db.delete(specialties).where(tenantScope(specialties, eq(specialties.id, id))).returning();
    if (!row) throw new NotFoundError('Specialty', id);
    return { id };
  }

  // ── Services ──
  listServices() {
    return this.db.query.services.findMany({
      where: tenantScope(services, eq(services.clinicId, TenantContext.clinicId())),
      with: { specialty: true },
      orderBy: asc(services.name),
    });
  }
  async createService(dto: z.infer<typeof serviceSchema>) {
    const [row] = await this.db.insert(services).values(withTenant({ ...dto, clinicId: TenantContext.clinicId() })).returning();
    return row;
  }
  async updateService(id: string, dto: Partial<z.infer<typeof serviceSchema>>) {
    const [row] = await this.db.update(services).set(dto).where(tenantScope(services, eq(services.id, id))).returning();
    if (!row) throw new NotFoundError('Service', id);
    return row;
  }
  async deleteService(id: string) {
    const [row] = await this.db.delete(services).where(tenantScope(services, eq(services.id, id))).returning();
    if (!row) throw new NotFoundError('Service', id);
    return { id };
  }
}
