import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../../database/tenant';
import { ForbiddenError } from '../errors/app-error';
import { IS_PUBLIC, PERMISSIONS_KEY } from '../decorators/auth.decorators';

/** Enforces @RequirePermissions on the backend — hiding buttons in the UI is never the only control. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    if (!required.length) return true;
    const principal = TenantContext.principal();
    const missing = required.filter((p) => !principal.permissions.has(p));
    if (missing.length) throw new ForbiddenError('FORBIDDEN', 'You do not have permission to perform this action', { missing });
    return true;
  }
}
