import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineArrowDownTray, HiOutlineCheckCircle, HiOutlineNoSymbol, HiOutlineShieldCheck, HiOutlineTrash, HiOutlineXCircle } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Display';
import { SkeletonRows } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, fullName } from '@/lib/format';
import { downloadBlob, fileSlug } from './download';
import type { ConsentRecord, PatientV3 } from './types';

function ConsentChip({ label, granted, detail }: { label: string; granted: boolean; detail?: string }) {
  const t = useT();
  const Icon = granted ? HiOutlineCheckCircle : HiOutlineXCircle;
  return (
    <div className={cn('flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2', granted ? 'border-success/30 bg-success-soft' : 'border-border bg-surface-2')}>
      <Icon className={cn('mt-0.5 shrink-0', granted ? 'text-success' : 'text-ink-3')} aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">
          {label}: {granted ? t('admin.privacy.yes') : t('admin.privacy.no')}
        </p>
        {detail && <p className="truncate text-xs text-ink-2">{detail}</p>}
      </div>
    </div>
  );
}

/** Consent status, history, data export and irreversible anonymization (GDPR / Ley 1581 style rights). */
export function PatientPrivacyPanel({ patient }: { patient: PatientV3 }) {
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const consents = useQuery({ queryKey: ['patients', patient.id, 'consents'], queryFn: () => api.get<ConsentRecord[]>(`/patients/${patient.id}/consents`) });

  const exportData = useMutation({
    mutationFn: () => api.get<unknown>(`/patients/${patient.id}/export`),
    onSuccess: (doc) => {
      downloadBlob(JSON.stringify(doc, null, 2), `patient-${fileSlug(fullName(patient))}-export.json`, 'application/json');
      toast.success(t('admin.privacy.exported'));
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });
  const anonymize = useMutation({
    mutationFn: () => api.post(`/patients/${patient.id}/anonymize`, { reason: reason.trim(), confirm: 'ANONYMIZE' }),
    onSuccess: () => {
      toast.success(t('admin.privacy.anonymized'));
      setOpen(false);
      setReason('');
      setConfirmText('');
      void qc.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const dataDetail = patient.consentAt
    ? [fmtDate(patient.consentAt, prefs.lang), patient.consentVersion ? t('admin.privacy.version', { version: patient.consentVersion }) : null].filter(Boolean).join(' · ')
    : undefined;
  const canConfirm = reason.trim().length >= 3 && confirmText === 'ANONYMIZE';
  const kindLabel = (k: ConsentRecord['kind']) => (k === 'MARKETING' ? t('admin.privacy.marketing') : t('admin.privacy.dataProcessing'));

  return (
    <Card aria-labelledby="pp-h">
      <CardHeader id="pp-h" title={t('admin.privacy.title')} icon={<HiOutlineShieldCheck />} />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <ConsentChip label={t('admin.privacy.dataProcessing')} granted={Boolean(patient.consentAt)} detail={dataDetail} />
          <ConsentChip label={t('admin.privacy.marketing')} granted={Boolean(patient.marketingConsentAt)} detail={patient.marketingConsentAt ? fmtDate(patient.marketingConsentAt, prefs.lang) : undefined} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{t('admin.privacy.history')}</h3>
          {consents.isLoading ? (
            <SkeletonRows rows={2} />
          ) : !consents.data?.length ? (
            <p className="text-sm text-ink-3">{t('admin.privacy.noHistory')}</p>
          ) : (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {consents.data.map((c, i) => (
                <li key={`${c.createdAt}-${i}`} className="relative text-sm">
                  <span className={cn('absolute -left-[1.4rem] top-1 grid h-3 w-3 place-items-center rounded-full ring-2 ring-surface', c.granted ? 'bg-success' : 'bg-danger')} aria-hidden="true" />
                  <p className="font-medium">
                    {c.granted ? t('admin.privacy.granted') : t('admin.privacy.revoked')} · {kindLabel(c.kind)}
                  </p>
                  <p className="text-xs text-ink-3">
                    <time dateTime={c.createdAt}>{fmtDateTime(c.createdAt, prefs.lang)}</time>
                    {c.version && ` · ${t('admin.privacy.version', { version: c.version })}`}
                    {c.channel && ` · ${t('admin.privacy.via', { channel: c.channel })}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" icon={<HiOutlineArrowDownTray aria-hidden="true" />} loading={exportData.isPending} onClick={() => exportData.mutate()}>
            {t('admin.privacy.export')}
          </Button>
          {can('patients.delete') && !patient.anonymizedAt && (
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<HiOutlineNoSymbol aria-hidden="true" />} onClick={() => setOpen(true)}>
              {t('admin.privacy.anonymize')}
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => !anonymize.isPending && setOpen(false)}
        title={t('admin.privacy.anonymize')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" icon={<HiOutlineTrash aria-hidden="true" />} disabled={!canConfirm} loading={anonymize.isPending} onClick={() => anonymize.mutate()}>
              {t('admin.privacy.anonymize')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-ink">{t('admin.privacy.anonymizeBody')}</p>
          <Field label={t('admin.privacy.reason')} required>
            <Textarea rows={2} maxLength={300} placeholder={t('admin.privacy.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" />
          </Field>
          <Field label={t('admin.privacy.typeToConfirm')} required>
            <Input autoComplete="off" spellCheck={false} className="font-mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
