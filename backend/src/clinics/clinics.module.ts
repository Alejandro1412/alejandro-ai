import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClinicsController } from './clinics.controller';
import { ClinicsService } from './clinics.service';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  imports: [BillingModule],
  controllers: [ClinicsController],
  providers: [ClinicsService, TenantProvisioningService],
  exports: [ClinicsService, TenantProvisioningService],
})
export class ClinicsModule {}
