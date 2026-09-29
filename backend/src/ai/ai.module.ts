import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../appointments/availability.service';
import { ClinicsModule } from '../clinics/clinics.module';
import { ClinicsService } from '../clinics/clinics.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { HandoffService } from '../conversations/handoff.service';
import { DB, type Database } from '../database/database.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { DoctorsService } from '../doctors/doctors.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PatientsModule } from '../patients/patients.module';
import { PatientsService } from '../patients/patients.service';
import { AgentConfigService } from './agent-config.service';
import { AiController } from './ai.controller';
import { ChatService } from './chat.service';
import { LLMFactory } from './llm/llm.factory';
import { MemoryService } from './memory/memory.service';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { SummarizerService } from './orchestrator/summarizer.service';
import { infoTools } from './tools/definitions/info.tools';
import { patientOpsTools } from './tools/definitions/patient-ops.tools';
import { schedulingTools } from './tools/definitions/scheduling.tools';
import type { AgentTool } from './tools/tool';
import type { ToolDeps } from './tools/tool-deps';
import { ToolRegistry, TOOLS } from './tools/tool-registry';

@Module({
  imports: [KnowledgeModule, ClinicsModule, DoctorsModule, AppointmentsModule, PatientsModule, ConversationsModule],
  controllers: [AiController],
  providers: [
    AgentConfigService,
    LLMFactory,
    MemoryService,
    SummarizerService,
    OrchestratorService,
    ChatService,
    ToolRegistry,
    {
      provide: TOOLS,
      inject: [DB, KnowledgeService, ClinicsService, DoctorsService, AvailabilityService, AppointmentsService, PatientsService, NotificationsService, HandoffService, ConversationsService, SummarizerService],
      useFactory: (...deps: unknown[]): AgentTool[] => {
        const [db, knowledge, clinics, doctors, availability, appointments, patients, notifications, handoff, conversations, summarizer] = deps;
        const d = { db, knowledge, clinics, doctors, availability, appointments, patients, notifications, handoff, conversations, summarizer } as ToolDeps & { db: Database };
        return [...infoTools(d), ...schedulingTools(d), ...patientOpsTools(d)] as AgentTool[];
      },
    },
  ],
  exports: [ChatService, OrchestratorService, AgentConfigService, SummarizerService],
})
export class AiModule {}
