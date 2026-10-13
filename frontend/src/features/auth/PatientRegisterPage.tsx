import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
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
  // Required by POST /auth/patient/register: explicit, informed authorization (Ley 1581 / GDPR-style).
  acceptPrivacy: z.boolean().refine((v) => v, { message: 'privacy' }),
  marketingConsent: z.boolean(),
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
  const privacyErrId = useId();
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { acceptPrivacy: false, marketingConsent: false } });
  const e = formState.errors;

  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      const res = await api.post<{ accessToken: string }>('/auth/patient/register', { ...v, acceptPrivacy: true, marketingConsent: v.marketingConsent, clinicSlug, locale: prefs.lang }, { anonymous: true });
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
        <div className="space-y-3 rounded-2xl border border-border bg-surface-2/50 p-4">
          <div>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong accent-[rgb(var(--primary))]"
                aria-required="true"
                aria-invalid={e.acceptPrivacy ? true : undefined}
                aria-describedby={e.acceptPrivacy ? privacyErrId : undefined}
                {...register('acceptPrivacy')}
              />
              <span>
                {t('pub.register.privacyBefore')}{' '}
                <Link to={`/legal/privacy?clinic=${encodeURIComponent(clinicSlug)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                  {t('pub.register.privacyLink')}
                  <span className="sr-only"> {t('pub.chat.newTab')}</span>
                </Link>{' '}
                {t('pub.register.privacyAfter')}
                <span className="ml-0.5 text-danger" aria-hidden="true">
                  *
                </span>
              </span>
            </label>
            {e.acceptPrivacy && (
              <p id={privacyErrId} role="alert" className="mt-1.5 pl-8 text-xs font-medium text-danger">
                {t('pub.register.privacyRequired')}
              </p>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong accent-[rgb(var(--primary))]" {...register('marketingConsent')} />
            <span>{t('pub.register.marketing')}</span>
          </label>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          {t('auth.createAccount')}
        </Button>
        <p className="text-center text-xs text-ink-3">
          <Link to="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
            {t('pub.legal.terms')}
          </Link>
          {' · '}
          <Link to={`/legal/privacy?clinic=${encodeURIComponent(clinicSlug)}`} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
            {t('pub.legal.privacy')}
          </Link>
        </p>
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
