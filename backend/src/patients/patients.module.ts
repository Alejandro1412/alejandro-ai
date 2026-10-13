import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PrivacyService } from '../privacy/privacy.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PrivacyService],
  exports: [PatientsService, PrivacyService],
})
export class PatientsModule {}
