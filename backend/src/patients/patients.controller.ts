import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { patientListSchema, patientSchema, PatientsService } from './patients.service';
import { PrivacyService } from '../privacy/privacy.service';

const anonymizeSchema = z.object({ reason: z.string().trim().min(3).max(300), confirm: z.literal('ANONYMIZE') });
export const csvImportSchema = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(false) });

@ApiTags('Patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly privacy: PrivacyService,
  ) {}

  @Post('import')
  @RequirePermissions('patients.create')
  @ApiZodBody(csvImportSchema)
  import(@Body(zv(csvImportSchema)) dto: z.infer<typeof csvImportSchema>) {
    return this.patients.importCsv(dto.csv, dto.dryRun);
  }

  @Get(':id/consents')
  @RequirePermissions('patients.read')
  consents(@Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.history(id);
  }

  /** Data-subject access / portability: everything stored about the patient as JSON. */
  @Get(':id/export')
  @RequirePermissions('patients.update')
  export(@Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.export(id);
  }

  /** Right to erasure. Irreversible; requires typing ANONYMIZE. */
  @Post(':id/anonymize')
  @RequirePermissions('patients.delete')
  @ApiZodBody(anonymizeSchema)
  anonymize(@Param('id', ParseUUIDPipe) id: string, @Body(zv(anonymizeSchema)) dto: z.infer<typeof anonymizeSchema>) {
    return this.privacy.anonymize(id, dto.reason);
  }

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
