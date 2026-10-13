import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { HiOutlineArrowUpCircle, HiOutlineSparkles, HiOutlineUserGroup } from 'react-icons/hi2';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Spinner } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn, fmtNumber } from '@/lib/format';
import type { Specialty } from '@/types';
import { criteriaFor, insertToken, MESSAGE_MAX, MESSAGE_MIN, renderMessage, type AudiencePreview, type Campaign, type CampaignKind } from './growth';

const STEPS = ['kind', 'audience', 'message'] as const;

/** Debounces a value (audience preview is recomputed while the user edits the criteria). */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function AudienceSummary({ data, loading }: { data?: AudiencePreview; loading: boolean }) {
  const t = useT();
  const { prefs } = usePreferences();
  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-4" role="status" aria-live="polite" aria-busy={loading}>
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <HiOutlineUserGroup className="text-lg text-primary" aria-hidden="true" />
        {t('growth.campaigns.audience')}
        {loading && <Spinner className="h-4 w-4 text-ink-3" />}
      </div>
      {data && (
        <>
          <p className="mt-2 font-display text-2xl font-bold text-ink">{t('growth.campaigns.recipients', { n: fmtNumber(data.recipients, prefs.lang) })}</p>
          <p className="mt-1 text-sm text-ink-2">{t('growth.campaigns.consentExplain', { x: fmtNumber(data.withMarketingConsent, prefs.lang), y: fmtNumber(data.patientsTotal, prefs.lang) })}</p>
          {data.recipients === 0 ? (
            <p className="mt-2 text-sm text-warning">{t('growth.campaigns.noRecipients')}</p>
          ) : (
            data.sample.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{t('growth.campaigns.sample')}</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {data.sample.map((s) => (
                    <li key={s}>
                      <Badge>{s}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

export function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const counterId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<CampaignKind>('REACTIVATION');
  const [name, setName] = useState('');
  const [months, setMonths] = useState(6);
  const [days, setDays] = useState(30);
  const [specialtyId, setSpecialtyId] = useState('');
  const [message, setMessage] = useState(() => t('growth.campaigns.defaultReactivation'));
  const [messageTouched, setMessageTouched] = useState(false);
  const [planBlocked, setPlanBlocked] = useState(false);

  const criteria = criteriaFor(kind, { months, days, specialtyId });
  const debounced = useDebounced(JSON.stringify({ kind, criteria }));
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api.get<Specialty[]>('/specialties'), enabled: open && kind === 'REACTIVATION' });
  const preview = useQuery({
    queryKey: ['campaigns', 'preview', debounced],
    queryFn: () => api.post<AudiencePreview>('/campaigns/preview', JSON.parse(debounced) as unknown),
    enabled: open && step >= 1,
    staleTime: 30_000,
  });

  const chooseKind = (k: CampaignKind) => {
    setKind(k);
    if (!messageTouched) setMessage(t(k === 'REACTIVATION' ? 'growth.campaigns.defaultReactivation' : 'growth.campaigns.defaultReview'));
  };

  const reset = () => {
    setStep(0);
    setKind('REACTIVATION');
    setName('');
    setMonths(6);
    setDays(30);
    setSpecialtyId('');
    setMessage(t('growth.campaigns.defaultReactivation'));
    setMessageTouched(false);
    setPlanBlocked(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/campaigns', { kind, name: name.trim(), message: message.trim(), criteria }),
    onSuccess: () => {
      toast.success(t('growth.campaigns.created'));
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      close();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 402) setPlanBlocked(true);
      else toast.error(t('common.errorGeneric'), errorMessage(e));
    },
  });

  const len = message.trim().length;
  const messageOk = len >= MESSAGE_MIN && len <= MESSAGE_MAX;
  const stepOk = [name.trim().length >= 2, true, messageOk][step];
  const sampleFirst = preview.data?.sample[0]?.split(' ')[0] || t('growth.campaigns.sampleName');

  const insertName = () => {
    const el = textRef.current;
    const res = insertToken(message, el ? el.selectionStart : null);
    setMessage(res.text.slice(0, MESSAGE_MAX));
    setMessageTouched(true);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(res.caret, res.caret);
    });
  };

  const footer = planBlocked ? (
    <>
      <Button variant="secondary" onClick={close}>
        {t('common.close')}
      </Button>
      {can('billing.manage') && (
        <ButtonLink to="/settings/billing" icon={<HiOutlineArrowUpCircle aria-hidden="true" />}>
          {t('growth.common.upgrade')}
        </ButtonLink>
      )}
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={step === 0 ? close : () => setStep((s) => s - 1)}>
        {step === 0 ? t('common.cancel') : t('growth.common.back')}
      </Button>
      {step < STEPS.length - 1 ? (
        <Button onClick={() => setStep((s) => s + 1)} disabled={!stepOk}>
          {t('growth.common.next')}
        </Button>
      ) : (
        <Button onClick={() => create.mutate()} disabled={!stepOk || !name.trim()} loading={create.isPending}>
          {t('growth.campaigns.create')}
        </Button>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={close} title={t('growth.campaigns.new')} description={planBlocked ? undefined : t('growth.campaigns.stepOf', { n: step + 1, total: STEPS.length })} size="lg" footer={footer}>
      {planBlocked ? (
        <div role="alert" className="flex flex-col items-center px-2 py-6 text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-warning-soft text-xl text-warning">
            <HiOutlineArrowUpCircle aria-hidden="true" />
          </div>
          <p className="font-semibold text-ink">{t('growth.campaigns.planTitle')}</p>
          <p className="mt-1 max-w-sm text-sm text-ink-2">{t('growth.campaigns.planBody')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <ol className="flex gap-2" aria-label={t('growth.campaigns.stepOf', { n: step + 1, total: STEPS.length })}>
            {STEPS.map((s, i) => (
              <li key={s} className="flex-1" aria-current={i === step ? 'step' : undefined}>
                <span className={cn('block h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-surface-3')} aria-hidden="true" />
                <span className={cn('mt-1.5 block text-xs font-medium', i === step ? 'text-ink' : 'text-ink-3')}>{t(`growth.campaigns.steps.${s}`)}</span>
              </li>
            ))}
          </ol>

          {step === 0 && (
            <>
              <fieldset>
                <legend className="label">{t('growth.campaigns.steps.kind')}</legend>
                <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
                  {(['REACTIVATION', 'REVIEW'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => chooseKind(k)}
                      className={cn(
                        'rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        kind === k ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-border-strong',
                      )}
                    >
                      <span className="block font-semibold text-ink">{t(`growth.campaigns.kind.${k}`)}</span>
                      <span className="mt-1 block text-sm text-ink-2">{t(`growth.campaigns.kindHint.${k}`)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <Field label={t('growth.campaigns.name')} required>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('growth.campaigns.namePlaceholder')} autoComplete="off" />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              {kind === 'REACTIVATION' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('growth.campaigns.months')} hint={t('growth.campaigns.monthsHint')}>
                    <Input type="number" inputMode="numeric" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} onBlur={() => setMonths((m) => Math.min(60, Math.max(1, Math.round(m) || 1)))} />
                  </Field>
                  <Field label={t('growth.campaigns.specialty')}>
                    <Select value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
                      <option value="">{t('growth.campaigns.allSpecialties')}</option>
                      {specialties.data?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {prefs.lang === 'en' ? (s.nameEn ?? s.name) : s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : (
                <Field label={t('growth.campaigns.days')} hint={t('growth.campaigns.daysHint')}>
                  <Input type="number" inputMode="numeric" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} onBlur={() => setDays((d) => Math.min(90, Math.max(1, Math.round(d) || 1)))} />
                </Field>
              )}
              <AudienceSummary data={preview.data} loading={preview.isFetching} />
              {preview.isError && <p className="text-sm text-danger">{errorMessage(preview.error)}</p>}
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <div className="mb-1.5 flex items-end justify-between gap-2">
                  <label htmlFor={`${counterId}-msg`} className="label mb-0">
                    {t('growth.campaigns.message')}
                    <span className="ml-0.5 text-danger" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <Button size="sm" variant="subtle" icon={<HiOutlineSparkles aria-hidden="true" />} onClick={insertName}>
                    {t('growth.campaigns.insertName')}
                  </Button>
                </div>
                <Textarea
                  ref={textRef}
                  id={`${counterId}-msg`}
                  rows={5}
                  value={message}
                  maxLength={MESSAGE_MAX}
                  aria-required
                  aria-invalid={!messageOk || undefined}
                  aria-describedby={`${counterId}-hint ${counterId}-count`}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setMessageTouched(true);
                  }}
                />
                <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs">
                  <p id={`${counterId}-hint`} className="text-ink-3">
                    {kind === 'REVIEW' ? t('growth.campaigns.reviewMessageNote') : t('growth.campaigns.messageHint')}
                  </p>
                  <p id={`${counterId}-count`} className={cn('tabular-nums', messageOk ? 'text-ink-3' : 'font-medium text-danger')} aria-live="polite">
                    {len < MESSAGE_MIN ? t('growth.campaigns.tooShort', { min: MESSAGE_MIN }) : t('growth.campaigns.chars', { n: len, max: MESSAGE_MAX })}
                  </p>
                </div>
              </div>
              <div>
                <p className="label">{t('growth.campaigns.preview')}</p>
                <div className="rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="max-w-md whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-surface px-3.5 py-2.5 text-sm text-ink shadow-sm">{renderMessage(message, sampleFirst) || '…'}</div>
                  {kind === 'REACTIVATION' && <p className="mt-2 text-xs text-ink-3">{t('growth.campaigns.previewFooter')}</p>}
                </div>
              </div>
              <AudienceSummary data={preview.data} loading={preview.isFetching} />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
