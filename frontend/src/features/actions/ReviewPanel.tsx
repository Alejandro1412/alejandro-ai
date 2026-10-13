import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineHeart, HiOutlineStar, HiStar } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { useT, type TKey } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { isLowRating } from './helpers';
import { InlineError, PanelHeading, ResultState } from './parts';
import type { PanelProps } from './types';

const LABELS: TKey[] = ['pub.review.r1', 'pub.review.r2', 'pub.review.r3', 'pub.review.r4', 'pub.review.r5'];

/**
 * 1–5 star rating built on native radio inputs: arrow keys move/select, Tab enters/leaves the group,
 * and screen readers announce "n of 5 stars". The stars are only the visual for each radio.
 */
export function StarRating({ value, onChange, invalid, describedBy }: { value: number; onChange: (n: number) => void; invalid?: boolean; describedBy?: string }) {
  const t = useT();
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset aria-describedby={describedBy} aria-invalid={invalid || undefined}>
      <legend className="label">
        {t('pub.review.ratingLabel')}
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      </legend>
      <div className="flex items-center gap-1 sm:gap-1.5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= shown;
          return (
            <label
              key={n}
              onMouseEnter={() => setHover(n)}
              className={cn(
                'grid h-12 w-12 cursor-pointer place-items-center rounded-xl text-[2rem] transition-transform hover:scale-110 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary/30 motion-reduce:transition-none motion-reduce:hover:scale-100',
                on ? 'text-warning' : 'text-ink-3',
              )}
            >
              <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" aria-label={`${t('pub.review.starOf', { n })} — ${t(LABELS[n - 1])}`} />
              {on ? <HiStar aria-hidden="true" /> : <HiOutlineStar aria-hidden="true" />}
            </label>
          );
        })}
      </div>
      <p className="mt-1 h-5 text-sm font-medium text-ink-2" aria-hidden="true">
        {shown ? t(LABELS[shown - 1]) : ''}
      </p>
    </fieldset>
  );
}

export function ReviewPanel({ token, info }: PanelProps) {
  const t = useT();
  const errId = useId();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const send = useMutation({
    mutationFn: () => api.post<{ done: boolean; redirectUrl: string | null }>(`/public/actions/${encodeURIComponent(token)}`, { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) }, { anonymous: true }),
  });

  if (info.review?.answered) return <ResultState tone="success" icon={<HiOutlineHeart />} title={t('pub.review.answered')} />;

  if (send.isSuccess) {
    const low = isLowRating(rating);
    const url = send.data.redirectUrl;
    return (
      <ResultState tone={low ? 'info' : 'success'} icon={<HiOutlineHeart />} title={t('pub.review.thanksTitle')} body={low ? t('pub.review.lowBody') : url ? t('pub.review.shareBody') : t('pub.review.thanksBody')}>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-no-underline
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-fg shadow-sm hover:bg-primary-strong"
          >
            {t('pub.review.shareGoogle')} <HiOutlineArrowTopRightOnSquare aria-hidden="true" />
            <span className="sr-only">{t('pub.chat.newTab')}</span>
          </a>
        )}
      </ResultState>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!rating) {
      setMissing(true);
      return;
    }
    send.mutate();
  };

  const doctor = info.review?.doctor;
  return (
    <div>
      <PanelHeading
        title={t('pub.review.title')}
        subtitle={doctor ? t('pub.review.subtitleDoctor', { doctor, clinic: info.clinic.name }) : t('pub.review.subtitle', { clinic: info.clinic.name })}
      />
      <form onSubmit={submit} noValidate className="space-y-5">
        <div>
          <StarRating
            value={rating}
            onChange={(n) => {
              setRating(n);
              setMissing(false);
            }}
            invalid={missing}
            describedBy={missing ? errId : undefined}
          />
          {missing && (
            <p id={errId} role="alert" className="text-xs font-medium text-danger">
              {t('pub.review.pickRating')}
            </p>
          )}
        </div>
        <Field label={t('pub.review.commentLabel')}>
          <Textarea value={comment} maxLength={1000} rows={4} placeholder={t('pub.review.commentPlaceholder')} onChange={(e) => setComment(e.target.value)} disabled={send.isPending} />
        </Field>
        <InlineError error={send.error} clinic={info.clinic} />
        <Button type="submit" size="lg" className="w-full" loading={send.isPending}>
          {t('pub.review.submit')}
        </Button>
      </form>
    </div>
  );
}
