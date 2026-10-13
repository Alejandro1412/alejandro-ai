import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { env } from '../../config/env';
import { TenantContext } from '../../database/tenant';
import { RbacService } from '../../rbac/rbac.service';
import { UnauthorizedError } from '../errors/app-error';
import { IS_PUBLIC } from '../decorators/auth.decorators';

export interface AccessTokenPayload {
  sub: string;
  name: string;
  org: string;
  clinic: string;
  role: string;
  patientId?: string | null;
  /** Platform admin acting as this user (support impersonation; short-lived, audited, no refresh). */
  imp?: string;
  impName?: string;
}

/** Global guard: verifies the Bearer access token and binds tenant + principal to the request context. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7), { secret: env().JWT_SECRET });
    } catch {
      throw new UnauthorizedError('TOKEN_INVALID', 'Session expired or invalid');
    }
    const permissions = await this.rbac.permissionsFor(payload.role);
    TenantContext.assign({
      organizationId: payload.org,
      clinicId: payload.clinic,
      principal: {
        kind: payload.role === 'PATIENT' ? 'PATIENT' : 'USER',
        id: payload.sub,
        name: payload.imp ? `${payload.name} (soporte: ${payload.impName ?? 'admin'})` : payload.name,
        role: payload.role,
        permissions,
        ...(payload.imp ? { impersonatedBy: payload.imp } : {}),
        patientId: payload.patientId ?? null,
      },
    });
    return true;
  }
}
