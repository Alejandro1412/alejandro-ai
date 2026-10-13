/** Value report types + pure helpers (month math, deltas, plain-text summary). */

export type Channel = 'WEB' | 'PORTAL' | 'WHATSAPP' | 'PHONE';
export const CHANNELS: Channel[] = ['WEB', 'PORTAL', 'WHATSAPP', 'PHONE'];

export interface MonthMetrics {
  conversations: number;
  resolvedByAi: number;
  resolutionRate: number | null;
  afterHours: number;
  byChannel: Record<Channel, number>;
  appointmentsByAi: number;
  revenueBookedByAiCents: number;
  remindersSent: number;
  attendanceConfirmed: number;
  noShowRate: number | null;
  slotsRefilledFromWaitlist: number;
  reviews: number;
  averageRating: number | null;
  minutesSaved: number;
}

export interface ValueReport {
  month: string;
  clinic: { name: string; currency: string; minutesSavedPerConversation: number };
  current: MonthMetrics;
  previous: MonthMetrics;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isValidMonth = (m: string | null | undefined): m is string => Boolean(m && MONTH_RE.test(m));

/** YYYY-MM of a date in local time. */
export const monthOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Adds `n` months (may be negative) to a YYYY-MM string. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Midday on the 15th avoids any time-zone edge when formatting the month name. */
export const monthDate = (month: string) => new Date(`${month}-15T12:00:00`);

export type Delta = { kind: 'pct' | 'pp' | 'abs'; value: number } | { kind: 'new' } | null;

/** Relative change in % (rounded). `new` when there was nothing before; null when both are empty/unknown. */
export function pctDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? { kind: 'pct', value: 0 } : { kind: 'new' };
  return { kind: 'pct', value: Math.round(((current - previous) / previous) * 100) };
}

/** Difference in percentage points for metrics that are already rates. */
export function ppDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return null;
  return { kind: 'pp', value: Math.round((current - previous) * 10) / 10 };
}

/** Absolute difference (e.g. average rating), one decimal. */
export function absDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return null;
  return { kind: 'abs', value: Math.round((current - previous) * 10) / 10 };
}

export const hoursSaved = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/** Is the delta good news? `lowerIsBetter` flips the reading (no-show rate). Zero is neutral. */
export function deltaTone(d: Delta, lowerIsBetter = false): 'good' | 'bad' | 'neutral' {
  if (!d || d.kind === 'new') return d ? (lowerIsBetter ? 'bad' : 'good') : 'neutral';
  if (d.value === 0) return 'neutral';
  const up = d.value > 0;
  return up !== lowerIsBetter ? 'good' : 'bad';
}

export interface SummaryLabels {
  title: string;
  headline: string;
  lines: [label: string, value: string][];
}

/** Plain-text summary for the clipboard (email / WhatsApp friendly). */
export function buildSummary({ title, headline, lines }: SummaryLabels): string {
  return [title, '', headline, '', ...lines.map(([l, v]) => `• ${l}: ${v}`)].join('\n');
}
