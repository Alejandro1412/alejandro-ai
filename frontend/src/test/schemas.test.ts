import { describe, expect, it } from 'vitest';
import { loginSchema } from '@/features/auth/LoginPage';
import { registerSchema } from '@/features/auth/RegisterPage';

describe('form validation schemas', () => {
  it('login requires a valid email and a password', () => {
    expect(loginSchema.safeParse({ email: 'admin@novacare.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'admin', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'admin@novacare.co', password: '' }).success).toBe(false);
  });

  it('login trims the email', () => {
    const r = loginSchema.parse({ email: '  admin@novacare.co ', password: 'x' });
    expect(r.email).toBe('admin@novacare.co');
  });

  it('registration enforces a strong password (≥10 chars, letters and digits)', () => {
    const base = { name: 'Laura Méndez', clinicName: 'Clínica Sol', email: 'laura@sol.co' };
    expect(registerSchema.safeParse({ ...base, password: 'Short1' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'onlyletterspassword' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: '1234567890' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'ClinicaSol2026' }).success).toBe(true);
  });

  it('registration requires clinic and person names', () => {
    expect(registerSchema.safeParse({ name: 'L', clinicName: '', email: 'a@b.co', password: 'ClinicaSol2026' }).success).toBe(false);
  });
});
