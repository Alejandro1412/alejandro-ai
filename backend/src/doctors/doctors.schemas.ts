import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const doctorSchema = z.object({
  title: z.enum(['Dr.', 'Dra.', 'Lic.', 'Psic.', 'Nut.', 'Ft.']).default('Dr.'),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  specialtyId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']).default('ACTIVE'),
  defaultDurationMinutes: z.number().int().min(5).max(480).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  languages: z.array(z.enum(['es', 'en', 'pt', 'fr'])).min(1).default(['es']),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#4f46e5'),
  serviceIds: z.array(z.string().uuid()).max(100).optional(),
});

export const scheduleSchema = z.object({
  intervals: z
    .array(z.object({ dayOfWeek: z.number().int().min(1).max(7), startTime: hhmm, endTime: hhmm }))
    .max(50)
    .refine((xs) => xs.every((i) => i.startTime < i.endTime), 'startTime must be before endTime'),
});

export const timeOffSchema = z
  .object({
    type: z.enum(['BLOCK', 'BREAK', 'VACATION']).default('BLOCK'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const doctorListSchema = z.object({
  search: z.string().trim().max(80).optional(),
  specialtyId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']).optional(),
});
