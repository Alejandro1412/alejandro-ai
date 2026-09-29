import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage, tokenStore } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  password: z
    .string()
    .min(10)
    .regex(/[A-Za-z]/)
    .regex(/\d/),
});
type Form = z.infer<typeof schema>;

export default function PatientRegisterPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { reload } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const clinicSlug = params.get('clinic') ?? 'novacare';
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const e = formState.errors;

  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      const res = await api.post<{ accessToken: string }>('/auth/patient/register', { ...v, clinicSlug, locale: prefs.lang }, { anonymous: true });
      tokenStore.set(res.accessToken);
      await reload();
      nav('/portal', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold">{t('auth.patientRegisterTitle')}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('patients.firstName')} error={e.firstName && t('common.required')} required>
            <Input autoComplete="given-name" {...register('firstName')} />
          </Field>
          <Field label={t('patients.lastName')} error={e.lastName && t('common.required')} required>
            <Input autoComplete="family-name" {...register('lastName')} />
          </Field>
        </div>
        <Field label={t('common.email')} error={e.email && t('common.required')} required>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label={t('common.phone')} error={e.phone && t('common.required')} required>
          <Input type="tel" autoComplete="tel" inputMode="tel" {...register('phone')} />
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')} error={e.password && t('auth.passwordHint')} required>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          {t('auth.createAccount')}
        </Button>
        <p className="text-center text-xs text-ink-3">{t('auth.termsNote')}</p>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t('auth.login')}
        </Link>
      </p>
    </AuthLayout>
  );
}
