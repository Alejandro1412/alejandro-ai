import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../../rbac/permissions';
import { TenantContext, type Principal } from '../../database/tenant';
import { RAW_RESPONSE } from '../interceptors/response.interceptor';

export const IS_PUBLIC = 'is_public';
export const PERMISSIONS_KEY = 'required_permissions';

/** Skips JWT authentication for the route (webhooks, public chat, login…). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires ALL listed permissions. Enforced server-side by PermissionsGuard. */
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);

/** Opt out of the { success, data } envelope (e.g. webhook verification challenge). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

export interface AuthUser extends Principal {
  userId: string;
  organizationId: string;
  clinicId: string;
}

export const CurrentUser = createParamDecorator((_: unknown, _ctx: ExecutionContext): AuthUser => {
  const ctx = TenantContext.current();
  const p = TenantContext.principal();
  return { ...p, userId: p.id!, organizationId: ctx!.organizationId!, clinicId: ctx!.clinicId! };
});
