import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { memberships, roles, users } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { BusinessRuleError, ConflictError, NotFoundError } from '../common/errors/app-error';
import { randomToken } from '../common/utils/crypto';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { RbacService } from '../rbac/rbac.service';

export const STAFF_ROLES = ['CLINIC_ADMIN', 'DOCTOR', 'RECEPTIONIST'] as const;

export const inviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(STAFF_ROLES),
});
export const changeRoleSchema = z.object({ role: z.enum(STAFF_ROLES) });

/** Team & role management. Permission changes are always audited. */
@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async list() {
    return this.db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: roles.key,
        status: memberships.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.organizationId, TenantContext.orgId()), inArray(roles.key, [...STAFF_ROLES])))
      .orderBy(asc(users.name));
  }

  roles() {
    return this.rbac.permissionsFor('CLINIC_ADMIN').then(async () => {
      const all = await Promise.all(
        STAFF_ROLES.map(async (key) => ({ key, permissions: [...(await this.rbac.permissionsFor(key))].sort() })),
      );
      return all;
    });
  }

  /**
   * Creates the user with a one-time temporary password (returned once so an admin can share it
   * securely; an email invite provider can replace this flow without changing callers).
   */
  async invite(dto: z.infer<typeof inviteSchema>) {
    await this.billing.assertWithinLimit('users');
    const orgId = TenantContext.orgId();
    const roleId = await this.rbac.roleId(dto.role);
    let [user] = await this.db.select().from(users).where(eq(users.email, dto.email));
    const temporaryPassword = user ? null : `${randomToken(9)}A1`;
    if (!user) {
      [user] = await this.db
        .insert(users)
        .values({ email: dto.email, name: dto.name, passwordHash: await argon2.hash(temporaryPassword!, { type: argon2.argon2id }) })
        .returning();
    }
    const [existing] = await this.db.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.organizationId, orgId)));
    if (existing) throw new ConflictError('ALREADY_MEMBER', 'This user already belongs to the organization');
    const [m] = await this.db.insert(memberships).values({ userId: user.id, organizationId: orgId, clinicId: TenantContext.clinicId(), roleId }).returning();
    await this.audit.log({ action: 'team.member_invited', entityType: 'Membership', entityId: m.id, metadata: { email: dto.email, role: dto.role } });
    return { membershipId: m.id, userId: user.id, email: user.email, role: dto.role, temporaryPassword };
  }

  async changeRole(membershipId: string, role: (typeof STAFF_ROLES)[number]) {
    const m = await this.getMembership(membershipId);
    if (m.userId === TenantContext.principal().id) throw new BusinessRuleError('SELF_ROLE_CHANGE', 'You cannot change your own role');
    const roleId = await this.rbac.roleId(role);
    await this.db.update(memberships).set({ roleId }).where(eq(memberships.id, membershipId));
    await this.audit.log({ action: 'team.role_changed', entityType: 'Membership', entityId: membershipId, metadata: { to: role } });
    return { membershipId, role };
  }

  async remove(membershipId: string) {
    const m = await this.getMembership(membershipId);
    if (m.userId === TenantContext.principal().id) throw new BusinessRuleError('SELF_REMOVAL', 'You cannot remove yourself');
    await this.db.delete(memberships).where(eq(memberships.id, membershipId));
    await this.audit.log({ action: 'team.member_removed', entityType: 'Membership', entityId: membershipId });
    return { membershipId };
  }

  private async getMembership(id: string) {
    const [m] = await this.db.select().from(memberships).where(and(eq(memberships.id, id), eq(memberships.organizationId, TenantContext.orgId())));
    if (!m) throw new NotFoundError('Membership', id);
    return m;
  }
}
