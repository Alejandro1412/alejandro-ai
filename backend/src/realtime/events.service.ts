import { Injectable } from '@nestjs/common';
import { TenantContext } from '../database/tenant';
import { RealtimeEvent, RealtimeGateway } from './realtime.gateway';

/** Domain-facing facade over the socket gateway (keeps services free of transport details). */
@Injectable()
export class EventsService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emit(event: RealtimeEvent, payload: Record<string, unknown>): void {
    const ctx = TenantContext.current();
    if (!ctx?.organizationId || !ctx.clinicId) return;
    this.gateway.toClinic(ctx.organizationId, ctx.clinicId, event, payload);
  }

  emitToPatient(patientId: string, event: RealtimeEvent, payload: Record<string, unknown>): void {
    this.gateway.toPatient(patientId, event, payload);
  }
}
