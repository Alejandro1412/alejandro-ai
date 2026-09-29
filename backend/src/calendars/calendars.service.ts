import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { calendarIntegrations, doctors } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { decryptSecret, encryptSecret } from '../common/utils/crypto';
import { BusinessRuleError, NotFoundError, ValidationError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import type { CalendarConnection, CalendarEventInput, CalendarProvider, TimeRange } from './calendar-provider';
import { GoogleCalendarProvider } from './providers/google-calendar.provider';
import { MicrosoftCalendarProvider } from './providers/microsoft-calendar.provider';
import { InternalCalendarProvider, MockCalendarProvider } from './providers/mock-calendar.provider';

type ProviderKind = 'MOCK' | 'INTERNAL' | 'GOOGLE' | 'MICROSOFT';

interface ResolvedCalendar {
  provider: CalendarProvider;
  conn: CalendarConnection;
}

/** Resolves which calendar a doctor uses and shields the domain from provider failures. */
@Injectable()
export class CalendarsService {
  private readonly logger = new Logger(CalendarsService.name);
  readonly mock = new MockCalendarProvider();
  private readonly internal = new InternalCalendarProvider();
  private readonly microsoft = new MicrosoftCalendarProvider();
  readonly google: GoogleCalendarProvider | null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {
    const e = env();
    this.google =
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? new GoogleCalendarProvider(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, e.GOOGLE_REDIRECT_URI ?? `${e.API_URL}/api/calendars/google/callback`)
        : null;
  }

  private providerFor(kind: ProviderKind): CalendarProvider {
    switch (kind) {
      case 'GOOGLE':
        if (!this.google) throw new BusinessRuleError('CALENDAR_NOT_CONFIGURED', 'Google Calendar credentials are not configured');
        return this.google;
      case 'MICROSOFT':
        return this.microsoft;
      case 'INTERNAL':
        return this.internal;
      default:
        return this.mock;
    }
  }

  /** Doctor-specific integration first, then clinic-wide, then the internal calendar. */
  async resolve(doctorId: string): Promise<ResolvedCalendar> {
    const rows = await this.db
      .select()
      .from(calendarIntegrations)
      .where(
        tenantScope(
          calendarIntegrations,
          eq(calendarIntegrations.status, 'CONNECTED'),
          or(eq(calendarIntegrations.doctorId, doctorId), and(isNull(calendarIntegrations.doctorId), eq(calendarIntegrations.clinicId, TenantContext.clinicId()))),
        ),
      )
      .orderBy(desc(calendarIntegrations.doctorId));
    const row = rows.find((r) => r.doctorId === doctorId) ?? rows[0];
    if (!row) return { provider: this.internal, conn: { integrationId: null, externalCalendarId: null, credentials: null } };
    return {
      provider: this.providerFor(row.provider),
      conn: {
        integrationId: row.id,
        externalCalendarId: row.externalCalendarId,
        credentials: row.credentialsEncrypted ? (JSON.parse(decryptSecret(row.credentialsEncrypted)) as Record<string, string>) : null,
        saveCredentials: async (creds) => {
          await this.db
            .update(calendarIntegrations)
            .set({ credentialsEncrypted: encryptSecret(JSON.stringify(creds)) })
            .where(eq(calendarIntegrations.id, row.id));
        },
      },
    };
  }

  /** External busy blocks. A failing provider degrades to "no external busy" rather than blocking bookings. */
  async busy(doctorId: string, range: TimeRange): Promise<TimeRange[]> {
    const { provider, conn } = await this.resolve(doctorId);
    try {
      return await provider.getAvailability(conn, range);
    } catch (err) {
      this.logger.warn(`Calendar availability failed for doctor ${doctorId}: ${(err as Error).message}`);
      await this.markError(conn.integrationId, err);
      return [];
    }
  }

  async createEvent(doctorId: string, event: CalendarEventInput): Promise<string | null> {
    const { provider, conn } = await this.resolve(doctorId);
    try {
      return (await provider.createEvent(conn, event)).id;
    } catch (err) {
      this.logger.warn(`Calendar createEvent failed: ${(err as Error).message}`);
      await this.markError(conn.integrationId, err);
      return null;
    }
  }

  async updateEvent(doctorId: string, eventId: string | null, event: Partial<CalendarEventInput>): Promise<void> {
    if (!eventId) return;
    const { provider, conn } = await this.resolve(doctorId);
    await provider.updateEvent(conn, eventId, event).catch((err: Error) => this.markError(conn.integrationId, err));
  }

  async deleteEvent(doctorId: string, eventId: string | null): Promise<void> {
    if (!eventId) return;
    const { provider, conn } = await this.resolve(doctorId);
    await provider.deleteEvent(conn, eventId).catch((err: Error) => this.markError(conn.integrationId, err));
  }

  private async markError(integrationId: string | null, err: unknown) {
    if (!integrationId) return;
    await this.db
      .update(calendarIntegrations)
      .set({ error: (err as Error).message.slice(0, 500) })
      .where(eq(calendarIntegrations.id, integrationId));
  }

  // ── Integration management ──
  async list() {
    const rows = await this.db
      .select({
        id: calendarIntegrations.id,
        provider: calendarIntegrations.provider,
        status: calendarIntegrations.status,
        doctorId: calendarIntegrations.doctorId,
        accountEmail: calendarIntegrations.accountEmail,
        externalCalendarId: calendarIntegrations.externalCalendarId,
        connectedAt: calendarIntegrations.connectedAt,
        error: calendarIntegrations.error,
      })
      .from(calendarIntegrations)
      .where(tenantScope(calendarIntegrations, eq(calendarIntegrations.clinicId, TenantContext.clinicId())));
    return { integrations: rows, googleConfigured: Boolean(this.google) };
  }

  async connectLocal(kind: 'MOCK' | 'INTERNAL', doctorId: string | null) {
    if (doctorId) await this.assertDoctor(doctorId);
    await this.disconnectExisting(doctorId);
    const [row] = await this.db
      .insert(calendarIntegrations)
      .values(withTenant({ clinicId: TenantContext.clinicId(), doctorId, provider: kind, externalCalendarId: doctorId ?? 'clinic' }))
      .returning({ id: calendarIntegrations.id, provider: calendarIntegrations.provider });
    await this.audit.log({ action: 'calendar.connected', entityType: 'CalendarIntegration', entityId: row.id, metadata: { provider: kind, doctorId } });
    return row;
  }

  async googleAuthUrl(doctorId: string | null) {
    if (!this.google) throw new BusinessRuleError('CALENDAR_NOT_CONFIGURED', 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google Calendar');
    if (doctorId) await this.assertDoctor(doctorId);
    const state = await this.jwt.signAsync(
      { org: TenantContext.orgId(), clinic: TenantContext.clinicId(), doctorId, uid: TenantContext.principal().id },
      { secret: env().JWT_SECRET, expiresIn: '10m' },
    );
    return { url: this.google.authUrl(state) };
  }

  /** OAuth callback (public route): the signed `state` carries and protects the tenant binding. */
  async googleCallback(code: string, state: string): Promise<string> {
    if (!this.google) throw new BusinessRuleError('CALENDAR_NOT_CONFIGURED', 'Google Calendar is not configured');
    let s: { org: string; clinic: string; doctorId: string | null; uid: string };
    try {
      s = await this.jwt.verifyAsync(state, { secret: env().JWT_SECRET });
    } catch {
      throw new ValidationError('Invalid or expired OAuth state');
    }
    const { creds, email } = await this.google.exchangeCode(code);
    await TenantContext.run({ organizationId: s.org, clinicId: s.clinic }, async () => {
      await this.disconnectExisting(s.doctorId);
      const [row] = await this.db
        .insert(calendarIntegrations)
        .values(
          withTenant({
            clinicId: s.clinic,
            doctorId: s.doctorId,
            provider: 'GOOGLE' as const,
            externalCalendarId: 'primary',
            accountEmail: email,
            credentialsEncrypted: encryptSecret(JSON.stringify(creds)),
          }),
        )
        .returning({ id: calendarIntegrations.id });
      await this.audit.log({ action: 'calendar.connected', entityType: 'CalendarIntegration', entityId: row.id, actor: { type: 'USER', id: s.uid }, metadata: { provider: 'GOOGLE' } });
    });
    return `${env().APP_URL}/settings/integrations?calendar=connected`;
  }

  async disconnect(id: string) {
    const [row] = await this.db
      .update(calendarIntegrations)
      .set({ status: 'DISCONNECTED', credentialsEncrypted: null })
      .where(tenantScope(calendarIntegrations, eq(calendarIntegrations.id, id)))
      .returning({ id: calendarIntegrations.id });
    if (!row) throw new NotFoundError('CalendarIntegration', id);
    await this.audit.log({ action: 'calendar.disconnected', entityType: 'CalendarIntegration', entityId: id });
    return row;
  }

  private async disconnectExisting(doctorId: string | null) {
    await this.db
      .update(calendarIntegrations)
      .set({ status: 'DISCONNECTED', credentialsEncrypted: null })
      .where(
        tenantScope(
          calendarIntegrations,
          eq(calendarIntegrations.clinicId, TenantContext.clinicId()),
          doctorId ? eq(calendarIntegrations.doctorId, doctorId) : isNull(calendarIntegrations.doctorId),
        ),
      );
  }

  private async assertDoctor(doctorId: string) {
    const [d] = await this.db.select({ id: doctors.id }).from(doctors).where(tenantScope(doctors, eq(doctors.id, doctorId)));
    if (!d) throw new NotFoundError('Doctor', doctorId);
  }
}
