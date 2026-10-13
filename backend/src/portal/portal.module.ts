import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RawResponse, RequirePermissions } from '../common/decorators/auth.decorators';
import { streamTurn } from '../common/utils/sse';
import { publicStep, publicTurn } from '../ai/public-turn';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { ForbiddenError, NotFoundError } from '../common/errors/app-error';
import { TenantContext } from '../database/tenant';
import { AiModule } from '../ai/ai.module';
import { ChatService } from '../ai/chat.service';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../appointments/availability.service';
import { ClinicsModule } from '../clinics/clinics.module';
import { ClinicsService } from '../clinics/clinics.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { DoctorsModule } from '../doctors/doctors.module';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsModule } from '../patients/patients.module';
import { PatientsService } from '../patients/patients.service';
import { PrivacyService } from '../privacy/privacy.service';
import { chatSchema } from '../ai/ai.controller';
import { feedbackSchema } from '../conversations/conversations.controller';

const profileSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  preferredLanguage: z.enum(['es', 'en']).optional(),
});
const consentPatchSchema = z.object({ marketing: z.boolean() });
const bookSchema = z.object({ doctorId: z.string().uuid(), startTime: z.coerce.date(), serviceId: z.string().uuid().nullable().optional() });
const slotsSchema = z.object({
  specialtyId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
});

/** Patient self-service portal. Every route is scoped to the authenticated patient's own record. */
@ApiTags('Patient portal')
@ApiBearerAuth()
@RequirePermissions('portal.self')
@Controller('portal')
export class PortalController {
  constructor(
    private readonly patients: PatientsService,
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly clinics: ClinicsService,
    private readonly doctors: DoctorsService,
    private readonly chat: ChatService,
    private readonly conversations: ConversationsService,
    private readonly privacy: PrivacyService,
  ) {}

  /** Right of access / portability for the patient themself. */
  @Get('me/export')
  export() {
    return this.privacy.export(this.patientId());
  }

  @Get('me/consents')
  consents() {
    return this.privacy.history(this.patientId());
  }

  /** Patients can grant or withdraw marketing consent (reminders of follow-ups, campaigns, review requests). */
  @Patch('me/consents')
  @ApiZodBody(consentPatchSchema)
  async updateConsent(@Body(zv(consentPatchSchema)) dto: z.infer<typeof consentPatchSchema>) {
    await this.privacy.record({ patientId: this.patientId(), kind: 'MARKETING', granted: dto.marketing, channel: 'PORTAL' });
    return this.privacy.history(this.patientId());
  }

  private patientId(): string {
    const id = TenantContext.principal().patientId;
    if (!id) throw new ForbiddenError('NO_PATIENT_PROFILE', 'This account is not linked to a patient record');
    return id;
  }

  @Get('me')
  async me() {
    const p = await this.patients.get(this.patientId(), { audit: false });
    const clinic = await this.clinics.current();
    return {
      patient: { id: p.id, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, preferredLanguage: p.preferredLanguage, consentAt: p.consentAt, marketingConsentAt: p.marketingConsentAt },
      clinic: { privacyPolicyUrl: clinic.privacyPolicyUrl, slug: clinic.slug, name: clinic.name, phone: clinic.phone, email: clinic.email, address: clinic.address, city: clinic.city, timezone: clinic.timezone, businessHours: clinic.businessHours },
      locations: await this.clinics.listLocations(),
    };
  }

  @Patch('me')
  @ApiZodBody(profileSchema)
  update(@Body(zv(profileSchema)) dto: z.infer<typeof profileSchema>) {
    return this.patients.update(this.patientId(), dto);
  }

  @Get('appointments')
  async myAppointments() {
    const res = await this.appointments.list({ page: 1, pageSize: 100, patientId: this.patientId(), order: 'desc' });
    return res.items;
  }

  @Get('doctors')
  async doctorsList() {
    const rows = await this.doctors.list({ status: 'ACTIVE' });
    return rows.map((d) => ({ id: d.id, title: d.title, firstName: d.firstName, lastName: d.lastName, specialty: d.specialty, bio: d.bio, languages: d.languages, color: d.color, avatarUrl: d.avatarUrl }));
  }

  @Get('services')
  services() {
    return this.clinics.listServices();
  }

  @Get('specialties')
  specialties() {
    return this.clinics.listSpecialties();
  }

  @Get('slots')
  @ApiZodQuery(slotsSchema)
  slots(@Query(zv(slotsSchema)) q: z.infer<typeof slotsSchema>) {
    const from = q.from ?? new Date();
    return this.availability.findSlots({
      doctorIds: q.doctorId ? [q.doctorId] : undefined,
      specialtyId: q.specialtyId,
      serviceId: q.serviceId,
      from,
      to: new Date(from.getTime() + q.days * 86_400_000),
      perDoctorLimit: 24,
      limit: 120,
    });
  }

  @Post('appointments')
  @ApiZodBody(bookSchema)
  book(@Body(zv(bookSchema)) dto: z.infer<typeof bookSchema>) {
    return this.appointments.create({ ...dto, patientId: this.patientId(), status: 'CONFIRMED' }, { source: 'WEB' });
  }

  @Post('appointments/:id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zv(z.object({ reason: z.string().max(300).optional() }))) dto: { reason?: string }) {
    await this.appointments.getForPatient(id, this.patientId());
    return this.appointments.cancel(id, dto.reason ?? 'Cancelled by patient (portal)', { source: 'WEB' });
  }

  @Post('appointments/:id/reschedule')
  async reschedule(@Param('id', ParseUUIDPipe) id: string, @Body(zv(z.object({ startTime: z.coerce.date() }))) dto: { startTime: Date }) {
    await this.appointments.getForPatient(id, this.patientId());
    return this.appointments.reschedule(id, dto, { source: 'WEB' });
  }

  @Post('chat')
  @ApiZodBody(chatSchema)
  async chatSend(@Body(zv(chatSchema)) dto: z.infer<typeof chatSchema>) {
    const { conversationId, welcome } = await this.portalConversation(dto);
    return publicTurn(await this.chat.send(conversationId, dto.message, dto.action ?? null), welcome);
  }

  @Post('chat/stream')
  @RawResponse()
  @ApiZodBody(chatSchema)
  async chatStream(@Body(zv(chatSchema)) dto: z.infer<typeof chatSchema>, @Res() res: Response) {
    const { conversationId, welcome } = await this.portalConversation(dto);
    await streamTurn(res, async (onStep) => publicTurn(await this.chat.send(conversationId, dto.message, dto.action ?? null, publicStep(onStep)), welcome));
  }

  @Post('chat/:conversationId/messages/:messageId/feedback')
  @ApiZodBody(feedbackSchema)
  async feedback(@Param('conversationId', ParseUUIDPipe) conversationId: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body(zv(feedbackSchema)) dto: z.infer<typeof feedbackSchema>) {
    const conv = await this.conversations.getRaw(conversationId);
    if (conv.patientId !== this.patientId()) throw new NotFoundError('Conversation', conversationId);
    return this.conversations.setFeedback(conversationId, messageId, dto.value);
  }

  private async portalConversation(dto: z.infer<typeof chatSchema>) {
    let conversationId = dto.conversationId;
    let welcome = null;
    if (conversationId) {
      const conv = await this.conversations.getRaw(conversationId);
      if (conv.patientId !== this.patientId()) throw new NotFoundError('Conversation', conversationId);
    } else {
      const started = await this.chat.start({ channel: 'PORTAL', patientId: this.patientId(), language: dto.language });
      conversationId = started.conversation.id;
      welcome = started.welcome;
    }
    return { conversationId, welcome };
  }

  @Get('chat')
  async chatHistory() {
    const list = await this.conversations.list({ page: 1, pageSize: 1, patientId: this.patientId(), channel: 'PORTAL' });
    const latest = list.items[0];
    if (!latest) return null;
    const [msgs, conv] = await Promise.all([this.conversations.messages(latest.id, 100), this.conversations.getRaw(latest.id)]);
    return {
      conversationId: latest.id,
      status: latest.status,
      journey: (conv.metadata as Record<string, unknown>)?.journey ?? null,
      messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, attachments: m.attachments, feedback: m.feedback, createdAt: m.createdAt })),
    };
  }
}

@Module({
  imports: [AiModule, AppointmentsModule, ClinicsModule, ConversationsModule, DoctorsModule, PatientsModule],
  controllers: [PortalController],
})
export class PortalModule {}
