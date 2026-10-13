import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ForbiddenError } from '../common/errors/app-error';

export type ActorKind = 'USER' | 'AI_AGENT' | 'SYSTEM' | 'WEBHOOK' | 'PATIENT';

export interface Principal {
  kind: ActorKind;
  id: string | null;
  name: string;
  role: string;
  permissions: ReadonlySet<string>;
  /** Set when the principal is a patient (portal) or the AI acts on behalf of an identified patient. */
  patientId?: string | null;
  /** Set when a platform admin is impersonating this user. */
  impersonatedBy?: string;
}

export interface RequestContext {
  organizationId?: string;
  clinicId?: string;
  principal?: Principal;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Central tenant context. Every request (HTTP middleware), job and AI turn runs inside
 * `TenantContext.run(...)`. Repositories read the tenant from here — callers can never
 * pass an arbitrary organizationId, which is what guarantees Clinic A never reads Clinic B.
 */
export const TenantContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  current(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Mutates the current request store (used by the auth guard after verifying the JWT). */
  assign(patch: Partial<RequestContext>): void {
    const store = storage.getStore();
    if (!store) throw new Error('TenantContext.assign called outside of a context');
    Object.assign(store, patch);
  },
  orgId(): string {
    const id = storage.getStore()?.organizationId;
    if (!id) throw new ForbiddenError('TENANT_REQUIRED', 'No tenant bound to this request');
    return id;
  },
  clinicId(): string {
    const id = storage.getStore()?.clinicId;
    if (!id) throw new ForbiddenError('CLINIC_REQUIRED', 'No clinic bound to this request');
    return id;
  },
  principal(): Principal {
    const p = storage.getStore()?.principal;
    if (!p) throw new ForbiddenError('UNAUTHENTICATED', 'No principal bound to this request');
    return p;
  },
};

type TenantTable = { organizationId: PgColumn };

/** WHERE organization_id = <current tenant> AND ...conditions */
export function tenantScope(table: TenantTable, ...conditions: (SQL | undefined)[]): SQL {
  return and(eq(table.organizationId, TenantContext.orgId()), ...conditions) as SQL;
}

/** Adds the current tenant to an insert payload; an explicit mismatching organizationId is rejected. */
export function withTenant<T extends object>(data: T): T & { organizationId: string } {
  const orgId = TenantContext.orgId();
  const given = (data as { organizationId?: string }).organizationId;
  if (given && given !== orgId) throw new ForbiddenError('TENANT_MISMATCH', 'Cross-tenant write rejected');
  return { ...data, organizationId: orgId };
}
