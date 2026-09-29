import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { ValidationError } from '../common/errors/app-error';
import { BillingService } from './billing.service';

const checkoutSchema = z.object({ planKey: z.enum(['STARTER', 'PROFESSIONAL', 'CLINIC']), interval: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY') });
const cancelSchema = z.object({ cancel: z.boolean() });

@ApiTags('Billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Public pricing (landing page). */
  @Public()
  @Get('billing/plans')
  plans() {
    return this.billing.listPlans();
  }

  @Get('billing/overview')
  @ApiBearerAuth()
  @RequirePermissions('billing.manage')
  overview() {
    return this.billing.overview();
  }

  @Post('billing/checkout')
  @ApiBearerAuth()
  @RequirePermissions('billing.manage')
  @ApiZodBody(checkoutSchema)
  checkout(@Body(zv(checkoutSchema)) dto: z.infer<typeof checkoutSchema>, @CurrentUser() user: AuthUser) {
    return this.billing.checkout(dto.planKey, dto.interval, user.userId);
  }

  @Post('billing/portal')
  @ApiBearerAuth()
  @RequirePermissions('billing.manage')
  portal() {
    return this.billing.portal();
  }

  @Post('billing/cancel')
  @ApiBearerAuth()
  @RequirePermissions('billing.manage')
  @ApiZodBody(cancelSchema)
  cancel(@Body(zv(cancelSchema)) dto: z.infer<typeof cancelSchema>) {
    return this.billing.cancelAtPeriodEnd(dto.cancel);
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  stripeWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody) throw new ValidationError('Raw body required');
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
