import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { patientListSchema, patientSchema, PatientsService } from './patients.service';

@ApiTags('Patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermissions('patients.read')
  @ApiZodQuery(patientListSchema)
  list(@Query(zv(patientListSchema)) q: z.infer<typeof patientListSchema>) {
    return this.patients.list(q);
  }

  @Get(':id')
  @RequirePermissions('patients.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.patients.get(id);
  }

  @Post()
  @RequirePermissions('patients.create')
  @ApiZodBody(patientSchema)
  create(@Body(zv(patientSchema)) dto: z.infer<typeof patientSchema>) {
    return this.patients.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('patients.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zv(patientSchema.partial())) dto: Partial<z.infer<typeof patientSchema>>) {
    return this.patients.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('patients.delete')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.patients.remove(id);
  }
}
