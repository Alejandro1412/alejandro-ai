import { Global, Module } from '@nestjs/common';
import { UsageService } from '../usage/usage.service';
import { BillingController } from './billing.controller';
import { BillingProviderFactory } from './billing-provider';
import { BillingService } from './billing.service';

@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, BillingProviderFactory, UsageService],
  exports: [BillingService, UsageService],
})
export class BillingModule {}
