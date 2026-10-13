import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { clinics, memberships, organizations, patients, roles, subscriptions, plans, users, consentRecords } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { AuditService } from '../audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../common/errors/app-error';
import { RbacService } from '../rbac/rbac.service';
import { TenantProvisioningService } from '../clinics/tenant-provisioning.service';
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard';
import { IssuedTokens, TokenService } from './token.service';
import type { LoginDto, PatientRegisterDto, RegisterDto } from './auth.schemas';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
/** Pre-computed hash used to equalise timing when the email does not exist. */
let dummyHash: Promise<string> | null = null;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON_OPTS);
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const [user] = await this.db.select().from(users).where(eq(users.email, dto.email));
    dummyHash ??= argon2.hash('timing-equaliser-password', ARGON_OPTS);
    const valid = await argon2.verify(user?.passwordHash ?? (await dummyHash), dto.password).catch(() => false);
    if (!user || !valid) {
      await this.audit.log({
        action: 'auth.login_failed',
        result: 'FAILURE',
        actor: { type: 'USER', id: user?.id ?? null, name: dto.email },
        organizationId: null,
      });
      throw new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const payload = await this.buildPayload(user.id, dto.organizationId);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await this.audit.log({ action: 'auth.login', actor: { type: 'USER', id: user.id, name: user.name }, organizationId: payload.org });
    return this.tokens.issue(payload, meta);
  }

  async register(dto: RegisterDto, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, dto.email));
    if (existing) throw new ConflictError('EMAIL_TAKEN', 'An account with this email already exists');
    const passwordHash = await this.hashPassword(dto.password);
    const adminRoleId = await this.rbac.roleId('CLINIC_ADMIN');

    const { userId, organizationId } = await this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: dto.email, name: dto.name, passwordHash, locale: dto.locale }).returning();
      const { organization, clinic } = await this.provisioning.provision(tx, {
        organizationName: dto.clinicName,
        clinicName: dto.clinicName,
        timezone: dto.timezone,
        locale: dto.locale,
        planKey: dto.planKey,
      });
      await tx.insert(memberships).values({ userId: user.id, organizationId: organization.id, clinicId: clinic.id, roleId: adminRoleId });
      return { userId: user.id, organizationId: organization.id };
    });

    const payload = await this.buildPayload(userId, organizationId);
    await TenantContext.run({ organizationId, clinicId: payload.clinic }, () =>
      this.audit.log({ action: 'auth.register', actor: { type: 'USER', id: userId, name: dto.name }, organizationId }),
    );
    return this.tokens.issue(payload, meta);
  }

  /** Patient self-service registration for the portal of a given clinic. */
  async registerPatient(dto: PatientRegisterDto, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const [clinic] = await this.db.select().from(clinics).where(eq(clinics.slug, dto.clinicSlug));
    if (!clinic) throw new NotFoundError('Clinic');
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, dto.email));
    if (existing) throw new ConflictError('EMAIL_TAKEN', 'An account with this email already exists');
    const passwordHash = await this.hashPassword(dto.password);
    const patientRoleId = await this.rbac.roleId('PATIENT');

    const userId = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: dto.email, name: `${dto.firstName} ${dto.lastName}`, passwordHash, locale: dto.locale })
        .returning();
      await tx.insert(memberships).values({ userId: user.id, organizationId: clinic.organizationId, clinicId: clinic.id, roleId: patientRoleId });
      // Link an existing patient record with the same email in this tenant, or create one.
      const [match] = await tx
        .select()
        .from(patients)
        .where(and(eq(patients.organizationId, clinic.organizationId), eq(patients.email, dto.email)));
      const consent = { consentAt: new Date(), consentVersion: clinic.consentVersion, ...(dto.marketingConsent ? { marketingConsentAt: new Date() } : {}) };
      let patientId: string;
      if (match) {
        await tx.update(patients).set({ userId: user.id, ...consent }).where(eq(patients.id, match.id));
        patientId = match.id;
      } else {
        const [created] = await tx.insert(patients).values({
          ...consent,
          organizationId: clinic.organizationId,
          clinicId: clinic.id,
          userId: user.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          preferredLanguage: dto.locale,
          source: 'WEB',
        }).returning({ id: patients.id });
        patientId = created.id;
      }
      const evidence = { organizationId: clinic.organizationId, clinicId: clinic.id, patientId, version: clinic.consentVersion, channel: 'PORTAL', ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null };
      await tx.insert(consentRecords).values([
        { ...evidence, kind: 'DATA_PROCESSING' as const, granted: true },
        ...(dto.marketingConsent ? [{ ...evidence, kind: 'MARKETING' as const, granted: true }] : []),
      ]);
      return user.id;
    });
    return this.tokens.issue(await this.buildPayload(userId, clinic.organizationId), meta);
  }

  async refresh(refreshToken: string | undefined, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedError('REFRESH_MISSING', 'No session');
    let consumed: Awaited<ReturnType<TokenService['consume']>>;
    try {
      consumed = await this.tokens.consume(refreshToken);
    } catch (err) {
      if ((err as UnauthorizedError).code === 'REFRESH_REUSED') {
        await this.audit.log({ action: 'auth.refresh_reuse_detected', result: 'DENIED', organizationId: null });
      }
      throw err;
    }
    const payload = await this.buildPayload(consumed.userId, consumed.organizationId ?? undefined);
    return this.tokens.issue(payload, { ...meta, familyId: consumed.familyId });
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeByToken(refreshToken);
    await this.audit.log({ action: 'auth.logout' });
  }

  async me(userId: string) {
    const ctx = TenantContext.current();
    const [user] = await this.db
      .select({ id: users.id, email: users.email, name: users.name, locale: users.locale, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new NotFoundError('User');
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, ctx!.organizationId!));
    const [clinic] = await this.db
      .select({ id: clinics.id, name: clinics.name, slug: clinics.slug, timezone: clinics.timezone, locale: clinics.locale, onboardedAt: clinics.onboardedAt })
      .from(clinics)
      .where(eq(clinics.id, ctx!.clinicId!));
    const [sub] = await this.db
      .select({ status: subscriptions.status, planKey: plans.key, planName: plans.name, trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, org.id));
    const principal = TenantContext.principal();
    return {
      user,
      organization: { id: org.id, name: org.name, slug: org.slug },
      clinic,
      role: principal.role,
      permissions: [...principal.permissions].sort(),
      patientId: principal.patientId ?? null,
      subscription: sub ?? null,
      impersonatedBy: principal.impersonatedBy ?? null,
      isPlatformAdmin: principal.permissions.has('platform.admin'),
    };
  }

  async updateProfile(userId: string, patch: { name?: string; locale?: 'es' | 'en' }) {
    await this.db.update(users).set(patch).where(eq(users.id, userId));
    return this.me(userId);
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || !(await argon2.verify(user.passwordHash, current))) throw new ValidationError('Current password is incorrect');
    await this.db.update(users).set({ passwordHash: await this.hashPassword(next) }).where(eq(users.id, userId));
    await this.tokens.revokeAllForUser(userId);
  }

  private async buildPayload(userId: string, organizationId?: string): Promise<AccessTokenPayload> {
    const rows = await this.db
      .select({ membership: memberships, roleKey: roles.key, userName: users.name })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE')));
    const row = organizationId ? rows.find((r) => r.membership.organizationId === organizationId) : rows[0];
    if (!row) throw new ForbiddenError('NO_MEMBERSHIP', 'This account has no active clinic membership');
    let clinicId = row.membership.clinicId;
    if (!clinicId) {
      const [first] = await this.db.select({ id: clinics.id }).from(clinics).where(eq(clinics.organizationId, row.membership.organizationId)).limit(1);
      clinicId = first?.id ?? null;
    }
    if (!clinicId) throw new ForbiddenError('NO_CLINIC', 'Organization has no clinic');
    let patientId: string | null = null;
    if (row.roleKey === 'PATIENT') {
      const [p] = await this.db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId));
      patientId = p?.id ?? null;
    }
    return { sub: userId, name: row.userName, org: row.membership.organizationId, clinic: clinicId, role: row.roleKey, patientId };
  }
}
