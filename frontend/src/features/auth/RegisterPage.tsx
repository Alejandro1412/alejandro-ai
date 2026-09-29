import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export const registerSchema = z.object({
  name: z.string().trim().min(2),
  clinicName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z
    .string()
    .min(10)
    .regex(/[A-Za-z]/)
    .regex(/\d/),
});
type Form = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { register: signUp } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(registerSchema) });
  const e = formState.errors;

  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      await signUp({ ...v, locale: prefs.lang });
      nav('/onboarding', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('auth.registerTitle')}</h1>
      <p className="mt-2 text-ink-2">{t('auth.registerSubtitle')}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('auth.yourName')} error={e.name && t('common.required')} required>
            <Input autoComplete="name" {...register('name')} />
          </Field>
          <Field label={t('auth.clinicName')} error={e.clinicName && t('common.required')} required>
            <Input autoComplete="organization" {...register('clinicName')} />
          </Field>
        </div>
        <Field label={t('auth.email')} error={e.email && t('common.required')} required>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')} error={e.password && t('auth.passwordHint')} required>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          {formState.isSubmitting ? t('auth.registering') : t('auth.createAccount')}
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
