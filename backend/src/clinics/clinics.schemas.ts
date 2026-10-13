import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const day = z.array(z.tuple([hhmm, hhmm])).max(4);

export const businessHoursSchema = z
  .object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day })
  .partial();

export const updateClinicSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  timezone: z.string().max(64).optional(),
  locale: z.enum(['es', 'en']).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  website: z.string().trim().url().max(300).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  businessHours: businessHoursSchema.optional(),
  privacyPolicyUrl: z.string().trim().url().max(500).nullable().optional(),
  /** Bump when the privacy notice changes; new consents record the new version. */
  consentVersion: z.string().trim().regex(/^[\w.-]{1,20}$/).optional(),
  googleReviewUrl: z.string().trim().url().max(500).nullable().optional(),
  depositsEnabled: z.boolean().optional(),
  minutesSavedPerConversation: z.number().int().min(1).max(60).optional(),
});

export const locationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(300),
  city: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  mapsUrl: z.string().trim().url().max(500).nullable().optional(),
});

export const specialtySchema = z.object({
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  keywords: z.array(z.string().trim().toLowerCase().max(40)).max(30).default([]),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  specialtyId: z.string().uuid().nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().length(3).toUpperCase().default('USD'),
  isActive: z.boolean().default(true),
  /** Deposit charged to hold self-service bookings when the clinic enables deposits. */
  depositCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /** Virtual service: bookings get a video-consultation link. */
  isVirtual: z.boolean().optional(),
  intakeFields: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
        label: z.string().trim().min(2).max(160),
        type: z.enum(['text', 'textarea', 'select', 'checkbox', 'date']),
        required: z.boolean().optional(),
        options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      }),
    )
    .max(15)
    .refine((xs) => new Set(xs.map((x) => x.key)).size === xs.length, 'Field keys must be unique')
    .optional(),
});
