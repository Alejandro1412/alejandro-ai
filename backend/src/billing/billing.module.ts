import { Global, Module } from '@nestjs/common';
import { UsageService } from '../usage/usage.service';
import { BillingController } from './billing.controller';
import { BillingProviderFactory } from './billing-provider';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { BillingService } from './billing.service';

@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, BillingLifecycleService, BillingProviderFactory, UsageService],
  exports: [BillingService, BillingLifecycleService, BillingProviderFactory, UsageService],
})
export class BillingModule {}
