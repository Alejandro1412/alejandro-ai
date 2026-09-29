import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { permissions, rolePermissions, roles } from '../database/schema';
import { PERMISSIONS, ROLE_DEFINITIONS, RoleKey } from './permissions';

/** Resolves role → permission set from the database with a short-lived cache. */
@Injectable()
export class RbacService {
  private cache = new Map<string, { perms: ReadonlySet<string>; at: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(@Inject(DB) private readonly db: Database) {}

  async permissionsFor(roleKey: string): Promise<ReadonlySet<string>> {
    const hit = this.cache.get(roleKey);
    if (hit && Date.now() - hit.at < RbacService.TTL_MS) return hit.perms;
    const rows = await this.db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(roles.key, roleKey));
    // Fallback to code definitions if the DB has not been synced yet.
    const perms = new Set<string>(rows.length ? rows.map((r) => r.key) : (ROLE_DEFINITIONS[roleKey as RoleKey]?.permissions ?? []));
    this.cache.set(roleKey, { perms, at: Date.now() });
    return perms;
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** Idempotently syncs system roles and permissions from code into the database. */
  async sync(): Promise<void> {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await this.db.insert(permissions).values({ key, description }).onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    const permRows = await this.db.select().from(permissions);
    const byKey = new Map(permRows.map((p) => [p.key, p.id]));
    for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
      const [role] = await this.db
        .insert(roles)
        .values({ key, name: def.name, description: def.description })
        .onConflictDoUpdate({ target: roles.key, set: { name: def.name, description: def.description } })
        .returning();
      await this.db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      const values = def.permissions.map((p) => ({ roleId: role.id, permissionId: byKey.get(p)! }));
      if (values.length) await this.db.insert(rolePermissions).values(values);
    }
    this.invalidate();
  }

  async roleId(key: RoleKey): Promise<string> {
    const [row] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    if (!row) throw new Error(`Role ${key} not found — run the seed / RBAC sync`);
    return row.id;
  }
}
