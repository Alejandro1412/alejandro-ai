import { useMutation } from '@tanstack/react-query';
import { HiOutlineBolt, HiOutlineCalendarDays, HiOutlineCreditCard, HiOutlineUser } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { useT } from '@/contexts/PreferencesContext';
import { api, ApiError } from '@/lib/api';
import { BookAgainLink, InlineError, PanelHeading, ResultState, useWhen } from './parts';
import type { PanelProps } from './types';

interface TakeResult {
  done: boolean;
  status: string;
  appointmentId: string;
  paymentUrl: string | null;
}

export function WaitlistPanel({ token, info }: PanelProps) {
  const t = useT();
  const when = useWhen();
  const offer = info.offer!;
  const take = useMutation({ mutationFn: () => api.post<TakeResult>(`/public/actions/${encodeURIComponent(token)}`, {}, { anonymous: true }) });
  const errCode = take.error instanceof ApiError ? take.error.code : null;

  if (take.isSuccess) {
    const paymentUrl = take.data.paymentUrl;
    return (
      <ResultState tone="success" title={t('pub.waitlist.doneTitle')} body={paymentUrl ? t('pub.waitlist.heldBody') : t('pub.waitlist.doneBody')}>
        {paymentUrl && (
          <>
            <a
              href={paymentUrl}
              data-no-underline
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-fg shadow-sm hover:bg-primary-strong"
            >
              <HiOutlineCreditCard aria-hidden="true" /> {t('pub.waitlist.payDeposit')}
            </a>
            <p className="text-xs text-ink-3">{t('pub.waitlist.payNote')}</p>
          </>
        )}
      </ResultState>
    );
  }
  if (errCode === 'OFFER_TAKEN') return <ResultState tone="warning" title={t('pub.waitlist.takenTitle')} body={t('pub.waitlist.takenBody')} />;
  if (errCode === 'OFFER_NOT_AVAILABLE' || !offer.available)
    return (
      <ResultState tone="warning" title={t('pub.waitlist.unavailableTitle')} body={t('pub.waitlist.unavailableBody')}>
        <BookAgainLink slug={info.clinic.slug} />
      </ResultState>
    );

  return (
    <div>
      <PanelHeading title={t('pub.waitlist.title')} subtitle={t('pub.waitlist.subtitle')} />
      <div className="relative overflow-hidden rounded-2xl border border-accent/40 bg-accent-soft p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-strong dark:text-accent">
          <HiOutlineBolt aria-hidden="true" /> {t('pub.waitlist.offer')}
        </p>
        <p className="mt-2 flex items-start gap-2 text-lg font-bold text-ink">
          <HiOutlineCalendarDays className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
          <span className="cap-first">{when(offer.start, info.clinic.timezone, offer.when)}</span>
        </p>
        {offer.doctor && (
          <p className="mt-1 flex items-center gap-2 text-sm text-ink-2">
            <HiOutlineUser className="shrink-0 text-ink-3" aria-hidden="true" />
            {offer.doctor}
          </p>
        )}
      </div>
      <div className="mt-6 space-y-3">
        {take.isError && <InlineError error={take.error} clinic={info.clinic} />}
        <Button size="lg" className="h-14 w-full text-[1.05rem] font-semibold" loading={take.isPending} onClick={() => take.mutate()}>
          {t('pub.waitlist.cta')}
        </Button>
      </div>
    </div>
  );
}
