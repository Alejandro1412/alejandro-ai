import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineShieldCheck } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Display';
import { Field, Input, Switch } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import type { Clinic } from '@/types';

export type ClinicV3 = Clinic & {
  privacyPolicyUrl?: string | null;
  consentVersion?: string;
  googleReviewUrl?: string | null;
  depositsEnabled?: boolean;
  minutesSavedPerConversation?: number;
};

const isUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const VERSION_RE = /^[\w.-]{1,20}$/;

/** Privacy notice, deposits, Google reviews and the value-report assumption (PATCH /clinics/current). */
export function ClinicPrivacyCard({ clinic, editable }: { clinic: ClinicV3; editable: boolean }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ privacyPolicyUrl: '', consentVersion: '', googleReviewUrl: '', depositsEnabled: false, minutes: '4' });
  useEffect(() => {
    setF({
      privacyPolicyUrl: clinic.privacyPolicyUrl ?? '',
      consentVersion: clinic.consentVersion ?? '',
      googleReviewUrl: clinic.googleReviewUrl ?? '',
      depositsEnabled: Boolean(clinic.depositsEnabled),
      minutes: String(clinic.minutesSavedPerConversation ?? 4),
    });
  }, [clinic]);

  const minutes = Number(f.minutes);
  const errors = {
    privacyPolicyUrl: f.privacyPolicyUrl.trim() && !isUrl(f.privacyPolicyUrl.trim()) ? t('admin.clinic.invalidUrl') : undefined,
    googleReviewUrl: f.googleReviewUrl.trim() && !isUrl(f.googleReviewUrl.trim()) ? t('admin.clinic.invalidUrl') : undefined,
    consentVersion: f.consentVersion.trim() && !VERSION_RE.test(f.consentVersion.trim()) ? t('admin.clinic.consentVersionInvalid') : undefined,
    minutes: !Number.isInteger(minutes) || minutes < 1 || minutes > 60 ? t('admin.clinic.invalidMinutes') : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () =>
      api.patch('/clinics/current', {
        privacyPolicyUrl: f.privacyPolicyUrl.trim() || null,
        ...(f.consentVersion.trim() ? { consentVersion: f.consentVersion.trim() } : {}),
        googleReviewUrl: f.googleReviewUrl.trim() || null,
        depositsEnabled: f.depositsEnabled,
        minutesSavedPerConversation: minutes,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['clinic'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  return (
    <Card aria-labelledby="clinic-privacy">
      <CardHeader id="clinic-privacy" title={t('admin.clinic.privacyTitle')} subtitle={t('admin.clinic.privacySubtitle')} icon={<HiOutlineShieldCheck />} />
      <fieldset disabled={!editable} className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
        <legend className="sr-only">{t('admin.clinic.privacyTitle')}</legend>
        <div className="sm:col-span-2">
          <Field label={t('admin.clinic.privacyUrl')} hint={t('admin.clinic.privacyUrlHint')} error={errors.privacyPolicyUrl}>
            <Input type="url" inputMode="url" placeholder="https://" maxLength={500} value={f.privacyPolicyUrl} onChange={(e) => setF({ ...f, privacyPolicyUrl: e.target.value })} />
          </Field>
          <a href={`/legal/privacy?clinic=${encodeURIComponent(clinic.slug)}`} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {t('admin.clinic.viewTemplate')} <HiOutlineArrowTopRightOnSquare aria-hidden="true" />
          </a>
        </div>
        <Field label={t('admin.clinic.consentVersion')} hint={t('admin.clinic.consentVersionHint')} error={errors.consentVersion}>
          <Input value={f.consentVersion} maxLength={20} className="font-mono" onChange={(e) => setF({ ...f, consentVersion: e.target.value })} />
        </Field>
        <Field label={t('admin.clinic.minutesSaved')} hint={t('admin.clinic.minutesSavedHint')} error={errors.minutes}>
          <Input type="number" inputMode="numeric" min={1} max={60} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
        </Field>
        <Field label={t('admin.clinic.googleReviewUrl')} hint={t('admin.clinic.googleReviewHint')} error={errors.googleReviewUrl} className="sm:col-span-2">
          <Input type="url" inputMode="url" placeholder="https://g.page/r/…/review" maxLength={500} value={f.googleReviewUrl} onChange={(e) => setF({ ...f, googleReviewUrl: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={f.depositsEnabled} onChange={(v) => setF({ ...f, depositsEnabled: v })} label={t('admin.clinic.depositsEnabled')} description={t('admin.clinic.depositsHint')} disabled={!editable} />
        </div>
      </fieldset>
      {editable && (
        <div className="flex justify-end border-t border-border p-4">
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </Card>
  );
}
