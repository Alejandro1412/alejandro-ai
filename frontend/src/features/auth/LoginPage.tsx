import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { HiOutlineEye, HiOutlineEyeSlash } from 'react-icons/hi2';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
type Form = z.infer<typeof loginSchema>;

const DEMO = [
  { email: 'admin@novacare.co', role: 'auth.roleAdmin' },
  { email: 'recepcion@novacare.co', role: 'auth.roleReception' },
  { email: 'carlos.perez@novacare.co', role: 'auth.roleDoctor' },
  { email: 'maria.rodriguez@example.com', role: 'auth.rolePatient' },
] as const;
const DEMO_PASSWORD = 'NovaCare2026!';

export default function LoginPage() {
  const t = useT();
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState } = useForm<Form>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      const me = await login(v.email, v.password);
      const next = params.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : me.role === 'PATIENT' ? '/portal' : me.clinic.onboardedAt ? '/dashboard' : '/onboarding', { replace: true });
    } catch (err) {
      setError(errorMessage(err, t('auth.invalidCredentials')));
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('auth.welcomeBack')}</h1>
      <p className="mt-2 text-ink-2">{t('auth.loginSubtitle')}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        <Field label={t('auth.email')} error={formState.errors.email && t('auth.invalidCredentials')} required>
          <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label={t('auth.password')} required>
          <div className="relative">
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-11" {...register('password')} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-3 hover:text-ink" aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}>
              {show ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          {formState.isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="font-semibold text-primary hover:underline">
          {t('auth.createAccount')}
        </Link>
      </p>
      <section aria-labelledby="demo-accounts" className="mt-8 rounded-2xl border border-dashed border-border-strong bg-surface p-4">
        <h2 id="demo-accounts" className="text-sm font-semibold">
          {t('auth.demoAccounts')}
        </h2>
        <p className="mt-0.5 text-xs text-ink-3">{t('auth.demoHint', { password: DEMO_PASSWORD })}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setValue('email', d.email);
                setValue('password', DEMO_PASSWORD);
                void handleSubmit(onSubmit)();
              }}
              className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-left text-xs hover:border-primary hover:bg-primary-soft"
            >
              <span className="block font-semibold text-ink">{t(d.role)}</span>
              <span className="block truncate text-ink-3">{d.email}</span>
            </button>
          ))}
        </div>
      </section>
    </AuthLayout>
  );
}
