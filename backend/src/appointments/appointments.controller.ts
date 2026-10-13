import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import {
  AppointmentsService,
  cancelSchema,
  createAppointmentSchema,
  listAppointmentsSchema,
  rescheduleSchema,
  seriesSchema,
  updateAppointmentSchema,
} from './appointments.service';
import { AvailabilityService } from './availability.service';

const slotsQuery = z.object({
  doctorId: z.string().uuid().optional(),
  specialtyId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  days: z.coerce.number().int().min(1).max(31).default(7),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  @RequirePermissions('appointments.read')
  @ApiZodQuery(listAppointmentsSchema)
  list(@Query(zv(listAppointmentsSchema)) q: z.infer<typeof listAppointmentsSchema>) {
    return this.appointments.list(q);
  }

  @Post('series')
  @RequirePermissions('appointments.create')
  @ApiOperation({ summary: 'Book a recurring series (weekly / biweekly / monthly). Conflicting dates are skipped and reported.' })
  @ApiZodBody(seriesSchema)
  series(@Body(zv(seriesSchema)) dto: z.infer<typeof seriesSchema>) {
    return this.appointments.createSeries(dto);
  }

  @Post('series/:seriesId/cancel')
  @RequirePermissions('appointments.delete')
  cancelSeries(@Param('seriesId', ParseUUIDPipe) seriesId: string, @Body(zv(cancelSchema)) dto: z.infer<typeof cancelSchema>) {
    return this.appointments.cancelSeries(seriesId, dto.reason);
  }

  @Get(':id/intake')
  @RequirePermissions('appointments.read')
  intake(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.intakeFor(id);
  }

  @Post(':id/confirm-attendance')
  @RequirePermissions('appointments.update')
  confirmAttendance(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.confirmAttendance(id, 'staff');
  }

  @Get('slots')
  @RequirePermissions('appointments.read')
  @ApiOperation({ summary: 'Real-time available slots (schedule − time off − appointments − external calendar)' })
  @ApiZodQuery(slotsQuery)
  slots(@Query(zv(slotsQuery)) q: z.infer<typeof slotsQuery>) {
    const from = q.from ?? new Date();
    return this.availability.findSlots({
      doctorIds: q.doctorId ? [q.doctorId] : undefined,
      specialtyId: q.specialtyId,
      serviceId: q.serviceId,
      from,
      to: new Date(from.getTime() + q.days * 86_400_000),
      limit: q.limit,
    });
  }

  @Get(':id')
  @RequirePermissions('appointments.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.get(id);
  }

  @Post()
  @RequirePermissions('appointments.create')
  @ApiZodBody(createAppointmentSchema)
  create(@Body(zv(createAppointmentSchema)) dto: z.infer<typeof createAppointmentSchema>) {
    return this.appointments.create(dto, { source: 'HUMAN' });
  }

  @Patch(':id')
  @RequirePermissions('appointments.update')
  @ApiZodBody(updateAppointmentSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zv(updateAppointmentSchema)) dto: z.infer<typeof updateAppointmentSchema>) {
    return this.appointments.update(id, dto);
  }

  @Post(':id/reschedule')
  @RequirePermissions('appointments.update')
  @ApiZodBody(rescheduleSchema)
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body(zv(rescheduleSchema)) dto: z.infer<typeof rescheduleSchema>) {
    return this.appointments.reschedule(id, dto, { source: 'HUMAN' });
  }

  @Post(':id/cancel')
  @RequirePermissions('appointments.delete')
  @ApiZodBody(cancelSchema)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zv(cancelSchema)) dto: z.infer<typeof cancelSchema>) {
    return this.appointments.cancel(id, dto.reason, { source: 'HUMAN' });
  }

  /** DELETE is a soft cancel: appointment history is preserved for audit integrity. */
  @Delete(':id')
  @RequirePermissions('appointments.delete')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.cancel(id, 'Deleted by staff', { source: 'HUMAN' });
  }
}
