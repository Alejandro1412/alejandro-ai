import { ExternalServiceError } from '../../common/errors/app-error';
import { CircuitBreaker, fetchJson } from '../../common/utils/resilience';
import type { CalendarConnection, CalendarEvent, CalendarEventInput, CalendarProvider, TimeRange } from '../calendar-provider';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Microsoft 365 / Outlook adapter over Microsoft Graph. Expects credentials { access_token }
 * obtained by an OAuth flow (the connection flow mirrors Google's and plugs into CalendarsService).
 */
export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly kind = 'MICROSOFT' as const;
  private readonly breaker = new CircuitBreaker('MicrosoftGraph');

  private async call<T>(conn: CalendarConnection, path: string, init: RequestInit = {}): Promise<T> {
    const token = conn.credentials?.access_token;
    if (!token) throw new ExternalServiceError('MicrosoftGraph', 'integration has no credentials');
    return this.breaker.exec(() =>
      fetchJson<T>(`${GRAPH}${path}`, {
        ...init,
        service: 'MicrosoftGraph',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }),
    );
  }

  private body(e: Partial<CalendarEventInput>) {
    return {
      ...(e.summary !== undefined ? { subject: e.summary } : {}),
      ...(e.description !== undefined ? { body: { contentType: 'text', content: e.description } } : {}),
      ...(e.start ? { start: { dateTime: e.start.toISOString(), timeZone: 'UTC' } } : {}),
      ...(e.end ? { end: { dateTime: e.end.toISOString(), timeZone: 'UTC' } } : {}),
      ...(e.location ? { location: { displayName: e.location } } : {}),
      ...(e.attendeeEmails ? { attendees: e.attendeeEmails.map((a) => ({ emailAddress: { address: a }, type: 'required' })) } : {}),
    };
  }

  async getAvailability(conn: CalendarConnection, range: TimeRange): Promise<TimeRange[]> {
    const events = await this.getEvents(conn, range);
    return events.map((e) => ({ start: e.start, end: e.end }));
  }

  async createEvent(conn: CalendarConnection, event: CalendarEventInput) {
    const res = await this.call<{ id: string }>(conn, '/me/events', { method: 'POST', body: JSON.stringify(this.body(event)) });
    return { id: res.id };
  }

  async updateEvent(conn: CalendarConnection, eventId: string, event: Partial<CalendarEventInput>) {
    await this.call(conn, `/me/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(this.body(event)) });
  }

  async deleteEvent(conn: CalendarConnection, eventId: string) {
    await this.call(conn, `/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  async getEvents(conn: CalendarConnection, range: TimeRange): Promise<CalendarEvent[]> {
    const q = new URLSearchParams({ startDateTime: range.start.toISOString(), endDateTime: range.end.toISOString() });
    const res = await this.call<{ value: { id: string; subject: string; start: { dateTime: string }; end: { dateTime: string } }[] }>(
      conn,
      `/me/calendarView?${q}`,
    );
    return res.value.map((v) => ({ id: v.id, summary: v.subject, start: new Date(`${v.start.dateTime}Z`), end: new Date(`${v.end.dateTime}Z`), timezone: 'UTC' }));
  }
}
