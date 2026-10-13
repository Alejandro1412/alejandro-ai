import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlineArrowDownTray, HiOutlineArrowTopRightOnSquare, HiOutlineShieldCheck, HiOutlineTrash } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { A11yPanel } from '@/layouts/Controls';
import type { PortalMe } from './PortalHome';

/** /portal/me also returns consent fields and the clinic's privacy settings (v3). */
type PortalMeV3 = PortalMe & {
  patient: PortalMe['patient'] & { consentAt?: string | null; marketingConsentAt?: string | null };
  clinic: PortalMe['clinic'] & { slug?: string; privacyPolicyUrl?: string | null };
};
interface ConsentRecord {
  id: string;
  kind: 'DATA_PROCESSING' | 'MARKETING';
  granted: boolean;
  version: string | null;
  channel: string | null;
  createdAt: string;
}

export default function PortalProfile() {
  const t = useT();
  const { setPrefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['portal', 'me'], queryFn: () => api.get<PortalMeV3>('/portal/me') });
  const [f, setF] = useState({ phone: '', email: '', preferredLanguage: 'es' });
  useEffect(() => {
    if (me.data) setF({ phone: me.data.patient.phone ?? '', email: me.data.patient.email ?? '', preferredLanguage: me.data.patient.preferredLanguage });
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/portal/me', { phone: f.phone || undefined, email: f.email || undefined, preferredLanguage: f.preferredLanguage }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setPrefs({ lang: f.preferredLanguage as 'es' | 'en' });
      void qc.invalidateQueries({ queryKey: ['portal'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!me.data) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('portal.profileTitle')}</h1>
      <Card>
        <CardHeader title={`${me.data.patient.firstName} ${me.data.patient.lastName}`} />
        <form
          className="grid gap-4 px-5 pb-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('common.phone')}>
            <Input type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label={t('common.email')}>
            <Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label={t('patients.language')}>
            <Select value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full sm:w-auto" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>
      <PrivacyCard me={me.data} />
      <Card>
        <CardHeader title={t('a11y.title')} />
        <A11yPanel />
      </Card>
    </div>
  );
}

/** Consent status, marketing opt-in/out, data export (portability) and how to request deletion. */
function PrivacyCard({ me }: { me: PortalMeV3 }) {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const tz = me.clinic.timezone;
  const consents = useQuery({ queryKey: ['portal', 'consents'], queryFn: () => api.get<ConsentRecord[]>('/portal/me/consents') });
  const marketingOn = Boolean(me.patient.marketingConsentAt);
  const lastProcessing = consents.data?.find((c) => c.kind === 'DATA_PROCESSING' && c.granted);
  const consentAt = me.patient.consentAt ?? lastProcessing?.createdAt ?? null;

  const marketing = useMutation({
    mutationFn: (on: boolean) => api.patch<ConsentRecord[]>('/portal/me/consents', { marketing: on }),
    onSuccess: (rows, on) => {
      qc.setQueryData(['portal', 'consents'], rows);
      void qc.invalidateQueries({ queryKey: ['portal', 'me'] });
      toast.success(on ? t('pub.profile.marketingOn') : t('pub.profile.marketingOff'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const exportData = useMutation({
    mutationFn: () => api.get<unknown>('/portal/me/export'),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = `${me.patient.firstName}-${me.patient.lastName}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9-]+/g, '');
      a.href = url;
      a.download = `${name || 'patient'}-export.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t('pub.profile.downloaded'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const policyHref = me.clinic.privacyPolicyUrl || `/legal/privacy${me.clinic.slug ? `?clinic=${encodeURIComponent(me.clinic.slug)}` : ''}`;
  const version = lastProcessing?.version ?? null;

  return (
    <Card aria-labelledby="privacy-title">
      <CardHeader id="privacy-title" icon={<HiOutlineShieldCheck aria-hidden="true" />} title={t('pub.profile.title')} subtitle={t('pub.profile.subtitle', { clinic: me.clinic.name })} />
      <div className="space-y-5 px-5 pb-5">
        <div className="rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">{t('pub.profile.processing')}</p>
            <Badge tone={consentAt ? 'success' : 'warning'} dot>
              {consentAt ? t('pub.profile.granted') : t('pub.profile.withdrawn')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {consentAt
              ? version
                ? t('pub.profile.processingSince', { date: fmtDate(consentAt, prefs.lang, tz), version })
                : t('pub.profile.processingSinceNoVersion', { date: fmtDate(consentAt, prefs.lang, tz) })
              : t('pub.profile.processingNone')}
          </p>
          <div className="mt-3 border-t border-border pt-1">
            <Switch label={t('pub.profile.marketing')} description={t('pub.profile.marketingHint')} checked={marketingOn} disabled={marketing.isPending} onChange={(v) => marketing.mutate(v)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <Button variant="secondary" className="w-full" loading={exportData.isPending} icon={<HiOutlineArrowDownTray aria-hidden="true" />} onClick={() => exportData.mutate()}>
              {t('pub.profile.download')}
            </Button>
            <p className="mt-1.5 text-xs text-ink-3">{t('pub.profile.downloadHint')}</p>
          </div>
          <a
            href={policyHref}
            target="_blank"
            rel="noopener noreferrer"
            data-no-underline
            className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-[0.9375rem] font-medium text-ink shadow-sm hover:border-border-strong hover:bg-surface-2"
          >
            <span className="truncate">{t('pub.profile.policy')}</span>
            <HiOutlineArrowTopRightOnSquare className="shrink-0" aria-hidden="true" />
            <span className="sr-only">{t('pub.chat.newTab')}</span>
          </a>
        </div>

        <div className="rounded-2xl bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <HiOutlineTrash aria-hidden="true" /> {t('pub.profile.deletionTitle')}
          </p>
          <p className="mt-1 text-sm text-ink-2">{t('pub.profile.deletionBody', { clinic: me.clinic.name })}</p>
          {(me.clinic.email || me.clinic.phone) && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {me.clinic.email && (
                <li>
                  <a href={`mailto:${me.clinic.email}`} className="text-primary hover:underline">
                    {t('pub.profile.contactEmail', { email: me.clinic.email })}
                  </a>
                </li>
              )}
              {me.clinic.phone && (
                <li>
                  <a href={`tel:${me.clinic.phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline">
                    {t('pub.profile.contactPhone', { phone: me.clinic.phone })}
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>

        {consents.data && consents.data.length > 0 && (
          <details className="group rounded-2xl border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">{t('pub.profile.history')}</summary>
            <ul className="mt-3 divide-y divide-border text-sm">
              {consents.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-ink-2">
                    {t(`pub.profile.${c.kind}` as const)}
                    {c.version ? ` · v${c.version}` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={c.granted ? 'success' : 'neutral'}>{c.granted ? t('pub.profile.granted') : t('pub.profile.withdrawn')}</Badge>
                    <span className="text-xs text-ink-3">{fmtDateTime(c.createdAt, prefs.lang, tz)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
