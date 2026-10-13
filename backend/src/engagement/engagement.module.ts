import { Module, OnModuleInit } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AppointmentsService } from '../appointments/appointments.service';
import { BillingService } from '../billing/billing.service';
import { TenantContext } from '../database/tenant';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';
import { PublicActionsController } from './public-actions.controller';

@Module({
  imports: [AppointmentsModule],
  controllers: [EngagementController, PublicActionsController],
  providers: [EngagementService],
  exports: [EngagementService],
})
export class EngagementModule implements OnModuleInit {
  constructor(
    private readonly billing: BillingService,
    private readonly appointments: AppointmentsService,
  ) {}

  /** Stripe deposit payments confirm the held appointment (billing stays decoupled from scheduling). */
  onModuleInit(): void {
    this.billing.onDepositPaid((organizationId, clinicId, appointmentId, reference) =>
      TenantContext.run(
        { organizationId, clinicId, principal: { kind: 'WEBHOOK', id: null, name: 'Stripe', role: 'SYSTEM', permissions: new Set() } },
        async () => {
          await this.appointments.markDepositPaid(appointmentId, reference);
        },
      ),
    );
  }
}
