/** Reviews & campaigns: API types and pure helpers. */

export interface ReviewStats {
  sent: number;
  responded: number;
  average: number | null;
  redirectedToGoogle: number;
  distribution: { rating: number; count: number }[];
  recent: { id: string; rating: number; comment: string | null; patient: string | null; doctor: string | null; at: string | null }[];
}

export type CampaignKind = 'REACTIVATION' | 'REVIEW';
export type CampaignStatus = 'DRAFT' | 'SENDING' | 'SENT';

export interface CampaignCriteria {
  monthsSinceLastVisit?: number;
  specialtyId?: string | null;
  daysSinceVisit?: number;
}

export interface Campaign {
  id: string;
  kind: CampaignKind;
  name: string;
  message: string;
  criteria: CampaignCriteria & { recipientIds?: string[] };
  status: CampaignStatus;
  stats: { recipients: number; sent: number; failed: number; booked: number };
  sentAt: string | null;
  createdAt: string;
}

export interface AudiencePreview {
  recipients: number;
  sample: string[];
  patientsTotal: number;
  withMarketingConsent: number;
}

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 900;
export const NAME_TOKEN = '{nombre}';

/** What a recipient sees: {nombre} / {name} replaced by their first name (same rule as the backend). */
export const renderMessage = (message: string, firstName: string) => message.replaceAll('{nombre}', firstName).replaceAll('{name}', firstName);

/** Inserts the name token at the caret (or the end), adding a space when needed. Returns the new text and caret. */
export function insertToken(text: string, caret: number | null, token = NAME_TOKEN): { text: string; caret: number } {
  const at = caret === null || caret < 0 || caret > text.length ? text.length : caret;
  const before = text.slice(0, at);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  const next = `${before}${pad}${token}${text.slice(at)}`;
  return { text: next, caret: at + pad.length + token.length };
}

/** Criteria actually sent to the API for a campaign kind (only the fields that matter). */
export function criteriaFor(kind: CampaignKind, c: { months: number; days: number; specialtyId: string }): CampaignCriteria {
  return kind === 'REACTIVATION' ? { monthsSinceLastVisit: clamp(c.months, 1, 60), specialtyId: c.specialtyId || null } : { daysSinceVisit: clamp(c.days, 1, 90) };
}

export const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);

/** Bookings within 14 days over messages actually sent, as a whole percentage. */
export const conversionPct = (stats: Campaign['stats']) => (stats.sent > 0 ? Math.round((stats.booked / stats.sent) * 100) : null);

/** Responded / sent as a whole percentage. */
export const responseRate = (r: Pick<ReviewStats, 'sent' | 'responded'>) => (r.sent > 0 ? Math.round((r.responded / r.sent) * 100) : null);
