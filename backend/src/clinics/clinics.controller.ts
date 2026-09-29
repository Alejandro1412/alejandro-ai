import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { locationSchema, serviceSchema, specialtySchema, updateClinicSchema } from './clinics.schemas';
import { ClinicsService } from './clinics.service';

@ApiTags('Clinics')
@ApiBearerAuth()
@Controller()
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  @Get('clinics')
  list() {
    return this.clinics.listClinics();
  }

  @Get('clinics/current')
  current() {
    return this.clinics.current();
  }

  @Patch('clinics/current')
  @RequirePermissions('settings.manage')
  @ApiZodBody(updateClinicSchema)
  update(@Body(zv(updateClinicSchema)) dto: z.infer<typeof updateClinicSchema>) {
    return this.clinics.update(dto);
  }

  @Post('clinics/current/onboarding/complete')
  @RequirePermissions('settings.manage')
  completeOnboarding() {
    return this.clinics.completeOnboarding();
  }

  // Locations
  @Get('locations')
  listLocations() {
    return this.clinics.listLocations();
  }
  @Post('locations')
  @RequirePermissions('settings.manage')
  @ApiZodBody(locationSchema)
  createLocation(@Body(zv(locationSchema)) dto: z.infer<typeof locationSchema>) {
    return this.clinics.createLocation(dto);
  }
  @Patch('locations/:id')
  @RequirePermissions('settings.manage')
  updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body(zv(locationSchema.partial())) dto: Partial<z.infer<typeof locationSchema>>) {
    return this.clinics.updateLocation(id, dto);
  }
  @Delete('locations/:id')
  @RequirePermissions('settings.manage')
  deleteLocation(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.deleteLocation(id);
  }

  // Specialties
  @Get('specialties')
  @RequirePermissions('services.read')
  listSpecialties() {
    return this.clinics.listSpecialties();
  }
  @Post('specialties')
  @RequirePermissions('services.write')
  @ApiZodBody(specialtySchema)
  createSpecialty(@Body(zv(specialtySchema)) dto: z.infer<typeof specialtySchema>) {
    return this.clinics.createSpecialty(dto);
  }
  @Patch('specialties/:id')
  @RequirePermissions('services.write')
  updateSpecialty(@Param('id', ParseUUIDPipe) id: string, @Body(zv(specialtySchema.partial())) dto: Partial<z.infer<typeof specialtySchema>>) {
    return this.clinics.updateSpecialty(id, dto);
  }
  @Delete('specialties/:id')
  @RequirePermissions('services.write')
  deleteSpecialty(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.deleteSpecialty(id);
  }

  // Services
  @Get('services')
  @RequirePermissions('services.read')
  listServices() {
    return this.clinics.listServices();
  }
  @Post('services')
  @RequirePermissions('services.write')
  @ApiZodBody(serviceSchema)
  createService(@Body(zv(serviceSchema)) dto: z.infer<typeof serviceSchema>) {
    return this.clinics.createService(dto);
  }
  @Patch('services/:id')
  @RequirePermissions('services.write')
  updateService(@Param('id', ParseUUIDPipe) id: string, @Body(zv(serviceSchema.partial())) dto: Partial<z.infer<typeof serviceSchema>>) {
    return this.clinics.updateService(id, dto);
  }
  @Delete('services/:id')
  @RequirePermissions('services.write')
  deleteService(@Param('id', ParseUUIDPipe) id: string) {
    return this.clinics.deleteService(id);
  }
}
