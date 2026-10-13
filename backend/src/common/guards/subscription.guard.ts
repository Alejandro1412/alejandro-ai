import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantContext } from '../../database/tenant';
import { AppError } from '../errors/app-error';
import { BillingLifecycleService } from '../../billing/billing-lifecycle.service';

export class SubscriptionInactiveError extends AppError {
  constructor(status: string) {
    super(402, 'SUBSCRIPTION_INACTIVE', 'Your subscription is inactive. Choose a plan in Settings → Billing to continue.', { status });
  }
}

/** Paths that keep working when the subscription is expired/suspended (so the clinic can pay or export). */
const ALWAYS_ALLOWED = [/^\/api\/auth\//, /^\/api\/billing/, /^\/api\/admin\//, /^\/api\/health/, /^\/api\/notifications/, /\/export$/];

/**
 * Read-only mode for expired or suspended tenants: GET requests keep working (data is never held
 * hostage) but writes are rejected with 402 until a plan is active again.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly lifecycle: BillingLifecycleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
    const ctx = TenantContext.current();
    if (!ctx?.organizationId || ctx.principal?.kind !== 'USER') return true;
    const path = req.originalUrl.split('?')[0];
    if (ALWAYS_ALLOWED.some((r) => r.test(path))) return true;
    const state = await this.lifecycle.state(ctx.organizationId);
    if (!state.active) throw new SubscriptionInactiveError(state.status);
    return true;
  }
}
