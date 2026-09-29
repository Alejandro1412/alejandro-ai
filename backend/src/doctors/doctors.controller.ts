import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { AvailabilityService } from '../appointments/availability.service';
import { doctorListSchema, doctorSchema, scheduleSchema, timeOffSchema } from './doctors.schemas';
import { DoctorsService } from './doctors.service';

const availabilityQuery = z.object({
  from: z.coerce.date().optional(),
  days: z.coerce.number().int().min(1).max(31).default(7),
  serviceId: z.string().uuid().optional(),
});

@ApiTags('Doctors')
@ApiBearerAuth()
@Controller('doctors')
export class DoctorsController {
  constructor(
    private readonly doctors: DoctorsService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  @RequirePermissions('doctors.read')
  @ApiZodQuery(doctorListSchema)
  list(@Query(zv(doctorListSchema)) q: z.infer<typeof doctorListSchema>) {
    return this.doctors.list(q);
  }

  @Get(':id')
  @RequirePermissions('doctors.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctors.get(id);
  }

  @Get(':id/availability')
  @RequirePermissions('doctors.read')
  @ApiZodQuery(availabilityQuery)
  slots(@Param('id', ParseUUIDPipe) id: string, @Query(zv(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    const from = q.from ?? new Date();
    return this.availability.findSlots({ doctorIds: [id], serviceId: q.serviceId, from, to: new Date(from.getTime() + q.days * 86_400_000), limit: 200 });
  }

  @Post()
  @RequirePermissions('doctors.create')
  @ApiZodBody(doctorSchema)
  create(@Body(zv(doctorSchema)) dto: z.infer<typeof doctorSchema>) {
    return this.doctors.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('doctors.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zv(doctorSchema.partial())) dto: Partial<z.infer<typeof doctorSchema>>) {
    return this.doctors.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('doctors.delete')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctors.remove(id);
  }

  @Put(':id/schedule')
  @RequirePermissions('doctors.update')
  @ApiZodBody(scheduleSchema)
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body(zv(scheduleSchema)) dto: z.infer<typeof scheduleSchema>) {
    return this.doctors.setSchedule(id, dto);
  }

  @Post(':id/time-off')
  @RequirePermissions('doctors.update')
  @ApiZodBody(timeOffSchema)
  addTimeOff(@Param('id', ParseUUIDPipe) id: string, @Body(zv(timeOffSchema)) dto: z.infer<typeof timeOffSchema>) {
    return this.doctors.addTimeOff(id, dto);
  }

  @Delete(':id/time-off/:timeOffId')
  @RequirePermissions('doctors.update')
  removeTimeOff(@Param('id', ParseUUIDPipe) id: string, @Param('timeOffId', ParseUUIDPipe) timeOffId: string) {
    return this.doctors.removeTimeOff(id, timeOffId);
  }
}
