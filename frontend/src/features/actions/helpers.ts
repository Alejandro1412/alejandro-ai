import { ApiError } from '@/lib/api';
import type { Lang } from '@/contexts/PreferencesContext';
import type { IntakeAnswers, IntakeField } from './types';

export type LoadProblem = 'not_found' | 'used' | 'expired' | 'network' | 'other';

/** Maps a failed GET of a patient link to the friendly state the page shows. */
export function classifyLoadError(err: unknown): LoadProblem {
  if (!(err instanceof ApiError)) return 'other';
  if (err.status === 0) return 'network';
  if (err.code === 'ACTION_LINK_USED') return 'used';
  if (err.code === 'ACTION_LINK_EXPIRED') return 'expired';
  if (err.status === 410) return 'expired';
  if (err.status === 404) return 'not_found';
  return 'other';
}

/** Two-letter monogram for the clinic mark (clinics have no logo upload yet). */
export function clinicMonogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  const letters = (words.length ? words : name.split(/\s+/)).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '');
  return letters.join('') || '•';
}

/**
 * Decides whether the page should switch to the appointment's language. Only when the visitor has not
 * picked a language themselves: their current language is still the browser default, or the one this
 * page applied automatically last time.
 */
export function pickLinkLanguage(linkLang: string | null | undefined, current: Lang, browserDefault: Lang, lastAuto: string | null): Lang | null {
  if (linkLang !== 'es' && linkLang !== 'en') return null;
  if (linkLang === current) return null;
  const explicit = current !== browserDefault && current !== lastAuto;
  return explicit ? null : linkLang;
}

export type IntakeError = 'required' | 'invalidOption' | 'invalidDate';

/** Starting values for the intake form: previous answers when present, otherwise empty. */
export function initialIntakeValues(fields: IntakeField[], answers: IntakeAnswers | null | undefined): IntakeAnswers {
  const out: IntakeAnswers = {};
  for (const f of fields) {
    const prev = answers?.[f.key];
    if (f.type === 'checkbox') out[f.key] = prev === true || prev === 'true';
    else out[f.key] = typeof prev === 'string' ? prev : '';
  }
  return out;
}

/** Client-side mirror of EngagementService.submitIntake validation (same rules, same order). */
export function validateIntake(fields: IntakeField[], values: IntakeAnswers): Record<string, IntakeError> {
  const errors: Record<string, IntakeError> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === 'checkbox') {
      if (f.required && v !== true) errors[f.key] = 'required';
      continue;
    }
    const s = typeof v === 'string' ? v.trim() : '';
    if (f.required && !s) errors[f.key] = 'required';
    else if (s && f.type === 'select' && f.options && !f.options.includes(s)) errors[f.key] = 'invalidOption';
    else if (s && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.key] = 'invalidDate';
  }
  return errors;
}

/** Body sent to the backend: trimmed strings (max 2000), booleans for checkboxes, empty strings dropped. */
export function normalizeIntake(fields: IntakeField[], values: IntakeAnswers): IntakeAnswers {
  const out: IntakeAnswers = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === 'checkbox') out[f.key] = v === true;
    else if (typeof v === 'string' && v.trim()) out[f.key] = v.trim().slice(0, 2000);
  }
  return out;
}

/** Ratings of 3 or less get an empathetic follow-up message instead of an invitation to share. */
export const isLowRating = (rating: number) => rating > 0 && rating <= 3;

/** Polling window after returning from the payment processor (`?paid=1`). */
export const PAYMENT_POLL_MS = 3_000;
export const PAYMENT_POLL_MAX_MS = 30_000;
