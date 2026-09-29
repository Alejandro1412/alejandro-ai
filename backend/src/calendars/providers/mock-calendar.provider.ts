import { randomUUID } from 'node:crypto';
import type { CalendarConnection, CalendarEvent, CalendarEventInput, CalendarProvider, TimeRange } from '../calendar-provider';

const overlaps = (a: TimeRange, b: TimeRange) => a.start < b.end && b.start < a.end;

/**
 * In-memory calendar for local development and tests. Behaves like a real external calendar
 * (events created here are reported as busy) so conflict detection can be exercised end-to-end.
 */
export class MockCalendarProvider implements CalendarProvider {
  readonly kind = 'MOCK' as const;
  private readonly events = new Map<string, CalendarEvent & { calendarKey: string }>();

  private key(conn: CalendarConnection) {
    return conn.externalCalendarId ?? conn.integrationId ?? 'default';
  }

  /** Test helper: simulate an event created outside Alejandro AI (e.g. doctor's personal block). */
  addExternalBusy(conn: CalendarConnection, range: TimeRange): string {
    const id = `mock_ext_${randomUUID()}`;
    this.events.set(id, { id, summary: 'Busy', start: range.start, end: range.end, timezone: 'UTC', calendarKey: this.key(conn), external: true } as never);
    return id;
  }

  async getAvailability(conn: CalendarConnection, range: TimeRange): Promise<TimeRange[]> {
    return [...this.events.values()]
      .filter((e) => e.calendarKey === this.key(conn) && (e as { external?: boolean }).external && overlaps(e, range))
      .map((e) => ({ start: e.start, end: e.end }));
  }

  async createEvent(conn: CalendarConnection, event: CalendarEventInput) {
    const id = `mock_evt_${randomUUID()}`;
    this.events.set(id, { ...event, id, calendarKey: this.key(conn) });
    return { id };
  }

  async updateEvent(_conn: CalendarConnection, eventId: string, patch: Partial<CalendarEventInput>) {
    const e = this.events.get(eventId);
    if (e) this.events.set(eventId, { ...e, ...patch });
  }

  async deleteEvent(_conn: CalendarConnection, eventId: string) {
    this.events.delete(eventId);
  }

  async getEvents(conn: CalendarConnection, range: TimeRange): Promise<CalendarEvent[]> {
    return [...this.events.values()].filter((e) => e.calendarKey === this.key(conn) && overlaps(e, range));
  }
}

/** Internal calendar: Alejandro AI's own appointments are the calendar; nothing external to sync. */
export class InternalCalendarProvider implements CalendarProvider {
  readonly kind = 'INTERNAL' as const;
  async getAvailability(): Promise<TimeRange[]> {
    return [];
  }
  async createEvent() {
    return { id: `int_${randomUUID()}` };
  }
  async updateEvent(): Promise<void> {}
  async deleteEvent(): Promise<void> {}
  async getEvents(): Promise<CalendarEvent[]> {
    return [];
  }
}
