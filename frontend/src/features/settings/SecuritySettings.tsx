import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineCheckCircle, HiOutlineShieldCheck } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Display';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';

const PRACTICES = [
  'Tenant isolation on every query (organization scope)',
  'RBAC enforced on the API, not only in the UI',
  'Argon2id password hashing',
  'Short-lived JWT + rotating httpOnly refresh cookie with reuse detection',
  'AES-256-GCM encryption for integration secrets',
  'Helmet security headers, strict CORS, rate limiting',
  'Input validation (Zod) on every endpoint',
  'Signed webhooks (WhatsApp X-Hub-Signature-256, Stripe-Signature)',
  'Audit log for patient access, AI tool calls and configuration changes',
  'AI can only act through permissioned tools — no SQL, no filesystem',
];

export default function SecuritySettings() {
  const t = useT();
  const { prefs, setPrefs } = usePreferences();
  const { me, reload } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me?.user.name ?? '');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const profile = useMutation({
    mutationFn: () => api.patch('/auth/me', { name, locale: prefs.lang }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pwd = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: cur, newPassword: next }),
    onSuccess: () => {
      toast.success(t('settings.passwordChanged'));
      setCur('');
      setNext('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <Card>
        <CardHeader title={t('settings.profile')} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label={t('common.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('common.email')}>
            <Input value={me?.user.email ?? ''} disabled />
          </Field>
          <Field label={t('common.language')}>
            <Select value={prefs.lang} onChange={(e) => setPrefs({ lang: e.target.value as 'es' | 'en' })}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button loading={profile.isPending} onClick={() => profile.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title={t('settings.changePassword')} />
        <form
          className="grid gap-4 px-5 pb-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            pwd.mutate();
          }}
        >
          <Field label={t('settings.currentPassword')}>
            <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </Field>
          <Field label={t('settings.newPassword')} hint={t('auth.passwordHint')}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" loading={pwd.isPending} disabled={!cur || next.length < 10}>
              {t('settings.changePassword')}
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title={t('settings.securityPractices')} icon={<HiOutlineShieldCheck />} />
        <ul className="grid gap-2 px-5 pb-4 sm:grid-cols-2">
          {PRACTICES.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-ink-2">
              <HiOutlineCheckCircle className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-5 py-3 text-xs text-ink-3">{t('settings.complianceNote')}</p>
      </Card>
    </>
  );
}
