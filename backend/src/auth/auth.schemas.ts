import { z } from 'zod';

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  organizationId: z.string().uuid().optional(),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  clinicName: z.string().trim().min(2).max(120),
  timezone: z.string().max(64).default('America/Bogota'),
  locale: z.enum(['es', 'en']).default('es'),
  planKey: z.enum(['STARTER', 'PROFESSIONAL', 'CLINIC']).default('PROFESSIONAL'),
});

export const patientRegisterSchema = z.object({
  clinicSlug: z.string().trim().min(2).max(80),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(20).optional(),
  password,
  locale: z.enum(['es', 'en']).default('es'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  locale: z.enum(['es', 'en']).optional(),
});

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type PatientRegisterDto = z.infer<typeof patientRegisterSchema>;
