/**
 * Calendar port. The domain (appointments, availability) depends only on this interface —
 * never on Google or Microsoft SDKs.
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  timezone: string;
  attendeeEmails?: string[];
  location?: string;
}

export interface CalendarEvent extends CalendarEventInput {
  id: string;
}

/** Decrypted connection context handed to providers (credentials never leave the calendar module). */
export interface CalendarConnection {
  integrationId: string | null;
  externalCalendarId: string | null;
  credentials: Record<string, string> | null;
  /** Lets the provider persist refreshed OAuth tokens. */
  saveCredentials?: (creds: Record<string, string>) => Promise<void>;
}

export interface CalendarProvider {
  readonly kind: 'MOCK' | 'INTERNAL' | 'GOOGLE' | 'MICROSOFT';
  /** Busy intervals from the external calendar (appointments stored locally are handled separately). */
  getAvailability(conn: CalendarConnection, range: TimeRange): Promise<TimeRange[]>;
  createEvent(conn: CalendarConnection, event: CalendarEventInput): Promise<{ id: string }>;
  updateEvent(conn: CalendarConnection, eventId: string, event: Partial<CalendarEventInput>): Promise<void>;
  deleteEvent(conn: CalendarConnection, eventId: string): Promise<void>;
  getEvents(conn: CalendarConnection, range: TimeRange): Promise<CalendarEvent[]>;
}
