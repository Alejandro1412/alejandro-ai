import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { agents, appointments, clinics, doctors, memberships, notifications, patients, roles } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { doctorDisplayName, formatWhen, personName } from '../common/utils/time';
import { offsetOf, Paginated } from '../common/utils/pagination';
import { QueueService, TenantJob } from '../jobs/queue.service';
import { EventsService } from '../realtime/events.service';
import { UsageService } from '../usage/usage.service';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { ChannelProviders } from './providers/channel-providers';
import { NotificationType, renderTemplate, TemplateVars } from './templates';

type Channel = 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'SMS';

interface DeliveryJob extends TenantJob {
  notificationId: string;
}

/** Multi-channel notifications. In-app rows are written immediately; external channels are delivered by a queue worker. */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly providers: ChannelProviders,
    private readonly usage: UsageService,
  ) {}

  onModuleInit(): void {
    this.queue.register<DeliveryJob>('notifications', (job) => this.deliver(job.notificationId));
    this.queue.register<TenantJob>('reminders', async () => {
      await this.sweepReminders();
    });
    void this.queue.every('reminders', 15 * 60_000, { organizationId: 'system' }).catch((e: Error) => this.logger.warn(`Reminder scheduler not started: ${e.message}`));
  }

  /** In-app notification for staff with the given roles (default: admins + receptionists) and optional extra users. */
  async notifyStaff(type: NotificationType, vars: TemplateVars, data: Record<string, unknown>, opts: { roleKeys?: string[]; userIds?: string[] } = {}) {
    const clinicId = TenantContext.clinicId();
    const roleKeys = opts.roleKeys ?? ['CLINIC_ADMIN', 'RECEPTIONIST'];
    const staff = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.organizationId, TenantContext.orgId()), inArray(roles.key, roleKeys), eq(memberships.status, 'ACTIVE')));
    const userIds = [...new Set([...staff.map((s) => s.userId), ...(opts.userIds ?? [])])];
    if (!userIds.length) return;
    const { title, body } = renderTemplate(type, 'es', vars);
    const rows = await this.db
      .insert(notifications)
      .values(userIds.map((userId) => withTenant({ clinicId, userId, type, channel: 'IN_APP' as const, title, body, data, status: 'SENT' as const, sentAt: new Date() })))
      .returning({ id: notifications.id, userId: notifications.userId });
    this.events.emit('notification.created', { type, title, body, data, count: rows.length });
  }

  /** Patient-facing notification over the configured external channels (queued). */
  async notifyPatient(type: NotificationType, patientId: string, vars: TemplateVars, channels: Channel[], data: Record<string, unknown> = {}) {
    const [patient] = await this.db.select().from(patients).where(tenantScope(patients, eq(patients.id, patientId)));
    if (!patient) return;
    const { title, body } = renderTemplate(type, patient.preferredLanguage, { patientName: patient.firstName, ...vars });
    for (const channel of channels) {
      if (channel === 'IN_APP') {
        if (patient.userId) {
          await this.db.insert(notifications).values(
            withTenant({ clinicId: patient.clinicId, userId: patient.userId, type, channel, title, body, data, status: 'SENT' as const, sentAt: new Date() }),
          );
          this.events.emitToPatient(patient.id, 'notification.created', { type, title });
        }
        continue;
      }
      const recipient = channel === 'EMAIL' ? patient.email : patient.phone;
      if (!recipient) continue;
      const [row] = await this.db
        .insert(notifications)
        .values(withTenant({ clinicId: patient.clinicId, type, channel, recipient, title, body, data: { ...data, patientId } }))
        .returning({ id: notifications.id });
      await this.queue.enqueue<DeliveryJob>('notifications', { organizationId: TenantContext.orgId(), clinicId: patient.clinicId, notificationId: row.id });
    }
  }

  private async deliver(notificationId: string): Promise<void> {
    const [n] = await this.db.select().from(notifications).where(tenantScope(notifications, eq(notifications.id, notificationId)));
    if (!n || n.status === 'SENT' || !n.recipient) return;
    try {
      if (n.channel === 'EMAIL') await this.providers.email.send({ to: n.recipient, subject: n.title, text: n.body });
      else if (n.channel === 'SMS') {
        await this.providers.sms.send({ to: n.recipient, body: n.body });
        await this.usage.record({ kind: 'SMS_MESSAGE', provider: this.providers.sms.name });
      } else if (n.channel === 'WHATSAPP') {
        await this.providers.whatsapp.sendMessage(n.recipient, `*${n.title}*\n${n.body}`);
        await this.usage.record({ kind: 'WHATSAPP_MESSAGE', provider: this.providers.whatsapp.name });
      }
      await this.db.update(notifications).set({ status: 'SENT', sentAt: new Date(), error: null }).where(eq(notifications.id, n.id));
    } catch (err) {
      await this.db.update(notifications).set({ status: 'FAILED', error: (err as Error).message.slice(0, 500) }).where(eq(notifications.id, n.id));
      throw err;
    }
  }

  /** Sends reminders for confirmed appointments inside each clinic's reminder window. Runs across tenants. */
  async sweepReminders(now = new Date()): Promise<number> {
    const clinicRows = await this.db
      .select({ clinic: clinics, rules: agents.notificationRules })
      .from(clinics)
      .innerJoin(agents, eq(agents.clinicId, clinics.id));
    let sent = 0;
    for (const { clinic, rules } of clinicRows) {
      const horizon = new Date(now.getTime() + (rules.reminderHoursBefore ?? 24) * 3_600_000);
      await TenantContext.run(
        {
          organizationId: clinic.organizationId,
          clinicId: clinic.id,
          principal: { kind: 'SYSTEM', id: null, name: 'System', role: 'SYSTEM', permissions: new Set(ROLE_DEFINITIONS.CLINIC_ADMIN.permissions) },
        },
        async () => {
          const due = await this.db
            .select({ appt: appointments, doctor: doctors })
            .from(appointments)
            .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
            .where(
              tenantScope(
                appointments,
                eq(appointments.clinicId, clinic.id),
                eq(appointments.status, 'CONFIRMED'),
                isNull(appointments.reminderSentAt),
                gte(appointments.startTime, now),
                lte(appointments.startTime, horizon),
              ),
            );
          for (const { appt, doctor } of due) {
            // Claim first to stay idempotent if two workers run the sweep.
            const claimed = await this.db
              .update(appointments)
              .set({ reminderSentAt: new Date() })
              .where(and(eq(appointments.id, appt.id), isNull(appointments.reminderSentAt)))
              .returning({ id: appointments.id });
            if (!claimed.length) continue;
            const [p] = await this.db.select().from(patients).where(eq(patients.id, appt.patientId));
            await this.notifyPatient(
              'APPOINTMENT_REMINDER',
              appt.patientId,
              { doctorName: doctorDisplayName(doctor), when: formatWhen(appt.startTime, clinic.timezone, p?.preferredLanguage ?? 'es'), clinicName: clinic.name },
              [...rules.onBooking.filter((c) => c !== 'IN_APP'), 'IN_APP'],
              { appointmentId: appt.id },
            );
            sent++;
          }
        },
      );
    }
    return sent;
  }

  /** Sends a reminder for one appointment on demand (used by the AI tool sendAppointmentReminder). */
  async sendReminderNow(appointmentId: string) {
    const [row] = await this.db
      .select({ appt: appointments, doctor: doctors, patient: patients, clinic: clinics })
      .from(appointments)
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
      .where(tenantScope(appointments, eq(appointments.id, appointmentId)));
    if (!row) throw new NotFoundError('Appointment', appointmentId);
    const channels: Channel[] = ['IN_APP', ...(row.patient.phone ? (['WHATSAPP'] as Channel[]) : []), ...(row.patient.email ? (['EMAIL'] as Channel[]) : [])];
    await this.notifyPatient(
      'APPOINTMENT_REMINDER',
      row.patient.id,
      { doctorName: doctorDisplayName(row.doctor), when: formatWhen(row.appt.startTime, row.clinic.timezone, row.patient.preferredLanguage), clinicName: row.clinic.name },
      channels,
      { appointmentId },
    );
    await this.db.update(appointments).set({ reminderSentAt: new Date() }).where(eq(appointments.id, appointmentId));
    return { sent: true, channels, patient: personName(row.patient) };
  }

  // ── Inbox API ──
  async list(userId: string, q: { page: number; pageSize: number; unreadOnly?: boolean }) {
    const where = tenantScope(notifications, eq(notifications.userId, userId), eq(notifications.channel, 'IN_APP'), q.unreadOnly ? isNull(notifications.readAt) : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ total: count() }).from(notifications).where(where),
    ]);
    return Paginated.of(items, total, q);
  }

  async unreadCount(userId: string) {
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(tenantScope(notifications, eq(notifications.userId, userId), eq(notifications.channel, 'IN_APP'), isNull(notifications.readAt)));
    return { unread: n };
  }

  async markRead(userId: string, id: string) {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(tenantScope(notifications, eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    if (!row) throw new NotFoundError('Notification', id);
    return row;
  }

  async markAllRead(userId: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(tenantScope(notifications, eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }

  /** Recent external deliveries for the integrations page. */
  async deliveries() {
    return this.db
      .select({
        id: notifications.id,
        type: notifications.type,
        channel: notifications.channel,
        recipient: notifications.recipient,
        status: notifications.status,
        error: notifications.error,
        createdAt: notifications.createdAt,
        sentAt: notifications.sentAt,
      })
      .from(notifications)
      .where(tenantScope(notifications, sql`${notifications.channel} <> 'IN_APP'`))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }
}
