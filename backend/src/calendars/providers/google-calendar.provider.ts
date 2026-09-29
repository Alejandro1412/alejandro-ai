import { ExternalServiceError } from '../../common/errors/app-error';
import { CircuitBreaker, fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import type { CalendarConnection, CalendarEvent, CalendarEventInput, CalendarProvider, TimeRange } from '../calendar-provider';

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'openid', 'email'];

interface GoogleCreds extends Record<string, string> {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/** Google Calendar adapter (REST + OAuth2 refresh), with retry and a circuit breaker. */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly kind = 'GOOGLE' as const;
  private readonly breaker = new CircuitBreaker('GoogleCalendar');

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES.join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string): Promise<{ creds: GoogleCreds; email: string | null }> {
    const res = await fetchJson<{ access_token: string; refresh_token: string; expires_in: number; id_token?: string }>(TOKEN_URL, {
      method: 'POST',
      service: 'Google OAuth',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    let email: string | null = null;
    if (res.id_token) {
      const payload = JSON.parse(Buffer.from(res.id_token.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
      email = payload.email ?? null;
    }
    return {
      creds: { access_token: res.access_token, refresh_token: res.refresh_token, expires_at: String(Date.now() + res.expires_in * 1000) },
      email,
    };
  }

  private async token(conn: CalendarConnection): Promise<string> {
    const creds = conn.credentials as GoogleCreds | null;
    if (!creds?.refresh_token) throw new ExternalServiceError('GoogleCalendar', 'integration has no credentials');
    if (Number(creds.expires_at) - 60_000 > Date.now()) return creds.access_token;
    const res = await fetchJson<{ access_token: string; expires_in: number }>(TOKEN_URL, {
      method: 'POST',
      service: 'Google OAuth',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const next: GoogleCreds = { ...creds, access_token: res.access_token, expires_at: String(Date.now() + res.expires_in * 1000) };
    conn.credentials = next;
    await conn.saveCredentials?.(next);
    return next.access_token;
  }

  private async call<T>(conn: CalendarConnection, path: string, init: RequestInit = {}): Promise<T> {
    return this.breaker.exec(() =>
      retry(
        async () =>
          fetchJson<T>(`${API}${path}`, {
            ...init,
            service: 'GoogleCalendar',
            headers: { Authorization: `Bearer ${await this.token(conn)}`, 'Content-Type': 'application/json' },
          }),
        { retries: 2, baseDelayMs: 300, shouldRetry: isRetryableHttp },
      ),
    );
  }

  private calId(conn: CalendarConnection) {
    return encodeURIComponent(conn.externalCalendarId ?? 'primary');
  }

  private toGoogle(e: Partial<CalendarEventInput>) {
    return {
      ...(e.summary !== undefined ? { summary: e.summary } : {}),
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.location !== undefined ? { location: e.location } : {}),
      ...(e.start ? { start: { dateTime: e.start.toISOString(), timeZone: e.timezone } } : {}),
      ...(e.end ? { end: { dateTime: e.end.toISOString(), timeZone: e.timezone } } : {}),
      ...(e.attendeeEmails ? { attendees: e.attendeeEmails.map((email) => ({ email })) } : {}),
    };
  }

  async getAvailability(conn: CalendarConnection, range: TimeRange): Promise<TimeRange[]> {
    const id = conn.externalCalendarId ?? 'primary';
    const res = await this.call<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(conn, '/freeBusy', {
      method: 'POST',
      body: JSON.stringify({ timeMin: range.start.toISOString(), timeMax: range.end.toISOString(), items: [{ id }] }),
    });
    return (res.calendars[id]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  async createEvent(conn: CalendarConnection, event: CalendarEventInput) {
    const res = await this.call<{ id: string }>(conn, `/calendars/${this.calId(conn)}/events`, {
      method: 'POST',
      body: JSON.stringify(this.toGoogle(event)),
    });
    return { id: res.id };
  }

  async updateEvent(conn: CalendarConnection, eventId: string, event: Partial<CalendarEventInput>) {
    await this.call(conn, `/calendars/${this.calId(conn)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify(this.toGoogle(event)),
    });
  }

  async deleteEvent(conn: CalendarConnection, eventId: string) {
    await this.call(conn, `/calendars/${this.calId(conn)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  async getEvents(conn: CalendarConnection, range: TimeRange): Promise<CalendarEvent[]> {
    const q = new URLSearchParams({ timeMin: range.start.toISOString(), timeMax: range.end.toISOString(), singleEvents: 'true', orderBy: 'startTime' });
    const res = await this.call<{ items: { id: string; summary?: string; description?: string; start: { dateTime?: string }; end: { dateTime?: string } }[] }>(
      conn,
      `/calendars/${this.calId(conn)}/events?${q}`,
    );
    return res.items
      .filter((i) => i.start.dateTime && i.end.dateTime)
      .map((i) => ({ id: i.id, summary: i.summary ?? '', description: i.description, start: new Date(i.start.dateTime!), end: new Date(i.end.dateTime!), timezone: 'UTC' }));
  }
}
