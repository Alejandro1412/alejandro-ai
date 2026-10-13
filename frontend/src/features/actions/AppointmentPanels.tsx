import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { HiOutlineBanknotes, HiOutlineCheckCircle, HiOutlineCreditCard, HiOutlineXCircle } from 'react-icons/hi2';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Feedback';
import { Field, Textarea } from '@/components/ui/Field';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { PAYMENT_POLL_MAX_MS, PAYMENT_POLL_MS } from './helpers';
import { AppointmentSummary, BookAgainLink, InlineError, Notice, PanelHeading, ResultState } from './parts';
import type { PanelProps } from './types';

const ACTIVE = new Set(['PENDING', 'CONFIRMED']);
export const actionKey = (token: string) => ['public-action', token] as const;

export function ConfirmPanel({ token, info }: PanelProps) {
  const t = useT();
  const appt = info.appointment!;
  const confirm = useMutation({ mutationFn: () => api.post<{ done: boolean; status: string }>(`/public/actions/${encodeURIComponent(token)}`, {}, { anonymous: true }) });

  if (confirm.isSuccess) return <ResultState tone="success" title={t('pub.confirm.doneTitle')} body={t('pub.confirm.doneBody', { clinic: info.clinic.name })} />;
  if (appt.status === 'CANCELLED')
    return (
      <ResultState tone="danger" title={t('pub.appt.cancelledNotice')}>
        <BookAgainLink slug={info.clinic.slug} />
      </ResultState>
    );
  if (appt.patientConfirmed)
    return (
      <div className="space-y-5">
        <ResultState tone="success" title={t('pub.confirm.alreadyTitle')} body={t('pub.confirm.alreadyBody')} />
        <AppointmentSummary appt={appt} clinic={info.clinic} />
      </div>
    );
  const active = ACTIVE.has(appt.status);
  return (
    <div>
      <PanelHeading title={t('pub.confirm.title')} subtitle={t('pub.confirm.subtitle', { name: appt.patientFirstName })} />
      <AppointmentSummary appt={appt} clinic={info.clinic} />
      <div className="mt-6 space-y-3">
        {!active && <Notice tone="warning">{t('pub.appt.inactiveNotice')}</Notice>}
        <InlineError error={confirm.error} clinic={info.clinic} />
        <Button size="lg" className="h-14 w-full text-[1.05rem] font-semibold" disabled={!active} loading={confirm.isPending} icon={<HiOutlineCheckCircle className="text-xl" aria-hidden="true" />} onClick={() => confirm.mutate()}>
          {t('pub.confirm.cta')}
        </Button>
      </div>
    </div>
  );
}

export function CancelPanel({ token, info }: PanelProps) {
  const t = useT();
  const appt = info.appointment!;
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const sureRef = useRef<HTMLHeadingElement>(null);
  const cancel = useMutation({
    mutationFn: () => api.post<{ done: boolean; status: string }>(`/public/actions/${encodeURIComponent(token)}`, reason.trim() ? { reason: reason.trim() } : {}, { anonymous: true }),
  });
  useEffect(() => {
    if (sure) sureRef.current?.focus();
  }, [sure]);

  if (cancel.isSuccess || appt.status === 'CANCELLED')
    return (
      <ResultState tone="danger" icon={<HiOutlineXCircle />} title={cancel.isSuccess ? t('pub.cancel.doneTitle') : t('pub.appt.cancelledNotice')} body={t('pub.cancel.doneBody', { clinic: info.clinic.name })}>
        <BookAgainLink slug={info.clinic.slug} />
      </ResultState>
    );
  const active = ACTIVE.has(appt.status);
  return (
    <div>
      <PanelHeading title={t('pub.cancel.title')} subtitle={t('pub.cancel.subtitle', { name: appt.patientFirstName })} />
      <AppointmentSummary appt={appt} clinic={info.clinic} showVideo={false} />
      {!active ? (
        <div className="mt-5">
          <Notice tone="warning">{t('pub.appt.inactiveNotice')}</Notice>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <Field label={t('pub.cancel.reasonLabel')} hint={t('pub.cancel.reasonHint')}>
            <Textarea value={reason} maxLength={300} rows={3} placeholder={t('pub.cancel.reasonPlaceholder')} onChange={(e) => setReason(e.target.value)} disabled={cancel.isPending} />
          </Field>
          {!sure ? (
            <Button variant="secondary" size="lg" className="w-full border-danger/40 text-danger hover:border-danger hover:bg-danger-soft" onClick={() => setSure(true)}>
              {t('pub.cancel.cta')}
            </Button>
          ) : (
            <div className="page-enter rounded-2xl border border-danger/40 bg-danger-soft p-4" role="group" aria-labelledby="cancel-sure-title">
              <h2 id="cancel-sure-title" ref={sureRef} tabIndex={-1} className="font-semibold text-ink focus:outline-none">
                {t('pub.cancel.sureTitle')}
              </h2>
              <p className="mt-1 text-sm text-ink-2">{t('pub.cancel.sureBody')}</p>
              <div className="mt-4 space-y-2.5">
                <InlineError error={cancel.error} clinic={info.clinic} />
                <Button variant="danger" size="lg" className="w-full" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                  {t('pub.cancel.sureYes')}
                </Button>
                <Button variant="secondary" size="lg" className="w-full" disabled={cancel.isPending} onClick={() => setSure(false)}>
                  {t('pub.cancel.keep')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentPanel({ token, info }: PanelProps) {
  const t = useT();
  const { prefs } = usePreferences();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const appt = info.appointment!;
  const returnedPaid = params.get('paid') === '1';
  const amount = fmtMoney(appt.depositCents, appt.currency, prefs.lang);
  const pay = useMutation({ mutationFn: () => api.post<{ done: boolean; status: string; simulated: boolean }>(`/public/actions/${encodeURIComponent(token)}`, {}, { anonymous: true }) });
  const polling = returnedPaid && !info.simulated && appt.depositStatus === 'PENDING';
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0);

  // After returning from the processor the webhook may land a few seconds later: re-read the link until PAID.
  useEffect(() => {
    if (!polling) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started >= PAYMENT_POLL_MAX_MS) {
        window.clearInterval(id);
        setSlow(true);
        return;
      }
      void qc.invalidateQueries({ queryKey: actionKey(token) });
    }, PAYMENT_POLL_MS);
    return () => window.clearInterval(id);
  }, [polling, qc, token, round]);

  if (pay.isSuccess || appt.depositStatus === 'PAID')
    return (
      <div className="space-y-5">
        <ResultState tone="success" icon={<HiOutlineBanknotes />} title={t('pub.payment.paidTitle')} body={t('pub.payment.paidBody')} />
        <AppointmentSummary appt={appt} clinic={info.clinic} />
      </div>
    );
  if (appt.depositStatus === 'EXPIRED' || appt.status === 'CANCELLED')
    return (
      <ResultState tone="warning" title={t('pub.payment.expired')}>
        <BookAgainLink slug={info.clinic.slug} />
      </ResultState>
    );
  if (appt.depositStatus === 'REFUNDED') return <ResultState tone="info" title={t('pub.payment.refunded')} />;
  if (appt.depositStatus === 'NONE')
    return (
      <div className="space-y-5">
        <ResultState tone="info" title={t('pub.payment.noDeposit')} />
        <AppointmentSummary appt={appt} clinic={info.clinic} />
      </div>
    );

  return (
    <div>
      <PanelHeading title={t('pub.payment.title')} subtitle={t('pub.payment.subtitle', { clinic: info.clinic.name })} />
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary-soft px-4 py-3.5">
        <span className="text-sm font-medium text-ink-2">{t('pub.payment.amount')}</span>
        <span className="font-display text-2xl font-bold tabular-nums text-ink">{amount ?? '—'}</span>
      </div>
      <AppointmentSummary appt={appt} clinic={info.clinic} showVideo={false} />
      <div className="mt-6 space-y-3">
        {polling ? (
          slow ? (
            <>
              <Notice tone="warning">{t('pub.payment.confirmingSlow')}</Notice>
              <Button variant="secondary" size="lg" className="w-full" onClick={() => {
                setSlow(false);
                setRound((r) => r + 1);
              }}>
                {t('pub.payment.checkAgain')}
              </Button>
            </>
          ) : (
            <div role="status" className="flex items-start gap-3 rounded-2xl border border-info/30 bg-info-soft px-4 py-3.5">
              <Spinner className="mt-0.5 shrink-0 text-info" />
              <div>
                <p className="font-semibold text-ink">{t('pub.payment.confirming')}</p>
                <p className="text-sm text-ink-2">{t('pub.payment.confirmingBody')}</p>
              </div>
            </div>
          )
        ) : info.simulated ? (
          <>
            <InlineError error={pay.error} clinic={info.clinic} />
            <Button size="lg" className="h-14 w-full text-[1.05rem] font-semibold" loading={pay.isPending} icon={<HiOutlineCreditCard className="text-xl" aria-hidden="true" />} onClick={() => pay.mutate()}>
              {t('pub.payment.simulate')}
            </Button>
            <p className="text-center text-xs font-medium text-warning">{t('pub.payment.simulatedNote')}</p>
          </>
        ) : (
          <Notice tone="info">{t('pub.payment.externalNote')}</Notice>
        )}
        {!polling && <p className="text-center text-xs text-ink-3">{t('pub.payment.heldNote')}</p>}
      </div>
    </div>
  );
}
