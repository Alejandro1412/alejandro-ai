import { useEffect, useRef, type ReactNode } from 'react';
import {
  HiOutlineCalendarDays,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineInformationCircle,
  HiOutlineMapPin,
  HiOutlinePhone,
  HiOutlineSparkles,
  HiOutlineUser,
  HiOutlineVideoCamera,
  HiOutlineXCircle,
} from 'react-icons/hi2';
import { ButtonLink } from '@/components/ui/Button';
import { usePreferences, useT, type TFn } from '@/contexts/PreferencesContext';
import { ApiError } from '@/lib/api';
import { cn, fmtDateLong, fmtTime } from '@/lib/format';
import { clinicMonogram } from './helpers';
import type { ActionAppointment, ActionClinic } from './types';

/** Clinic mark: monogram tile + name (clinics have no logo upload yet). */
export function ClinicMark({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary-strong font-display font-bold text-primary-fg shadow-sm',
        size === 'lg' ? 'h-14 w-14 text-lg' : 'h-11 w-11 text-base',
      )}
      aria-hidden="true"
    >
      {clinicMonogram(name)}
    </span>
  );
}

/** Formats an appointment start in the clinic timezone and the visitor's current language. */
export function useWhen() {
  const { prefs } = usePreferences();
  return (start: string | null | undefined, tz: string, fallback: string) => {
    if (!start || Number.isNaN(new Date(start).getTime())) return fallback;
    return `${fmtDateLong(start, prefs.lang, tz)} · ${fmtTime(start, prefs.lang, tz)}`;
  };
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-base text-ink-3" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-ink-3">{label}</dt>
        <dd className="break-words text-sm font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}

export function AppointmentSummary({ appt, clinic, showVideo = true }: { appt: ActionAppointment; clinic: ActionClinic; showVideo?: boolean }) {
  const t = useT();
  const when = useWhen();
  return (
    <section aria-label={t('pub.appt.summary')} className="rounded-2xl border border-border bg-surface-2/50 p-4">
      <dl className="grid gap-3.5">
        <Row icon={<HiOutlineCalendarDays />} label={t('pub.appt.when')}>
          <span className="cap-first">{when(appt.start, clinic.timezone, appt.when)}</span>
        </Row>
        <Row icon={<HiOutlineUser />} label={t('pub.appt.doctor')}>
          {appt.doctor}
          {appt.specialty && <span className="font-normal text-ink-2"> · {appt.specialty}</span>}
        </Row>
        {appt.service && (
          <Row icon={<HiOutlineSparkles />} label={t('pub.appt.service')}>
            {appt.service}
          </Row>
        )}
        {appt.videoUrl ? (
          <Row icon={<HiOutlineVideoCamera />} label={t('pub.appt.video')}>
            <span className="font-normal text-ink-2">{t('pub.appt.videoNote')}</span>
          </Row>
        ) : (
          appt.location && (
            <Row icon={<HiOutlineMapPin />} label={t('pub.appt.where')}>
              {appt.location}
            </Row>
          )
        )}
      </dl>
      {showVideo && appt.videoUrl && (
        <a
          href={appt.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-no-underline
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-ink hover:border-primary hover:text-primary"
        >
          <HiOutlineVideoCamera aria-hidden="true" /> {t('pub.appt.joinVideo')}
        </a>
      )}
    </section>
  );
}

type Tone = 'success' | 'danger' | 'warning' | 'info';
const toneCls: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
};
const toneIcon: Record<Tone, typeof HiOutlineCheckCircle> = {
  success: HiOutlineCheckCircle,
  danger: HiOutlineXCircle,
  warning: HiOutlineExclamationTriangle,
  info: HiOutlineInformationCircle,
};

/** Final/terminal state of a link (success, cancelled, taken…). Announced politely and focused for screen readers. */
export function ResultState({ tone, title, body, children, icon }: { tone: Tone; title: string; body?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [title]);
  const Icon = toneIcon[tone];
  return (
    <div role="status" className="page-enter flex flex-col items-center text-center">
      <span className={cn('grid h-16 w-16 place-items-center rounded-full text-3xl', toneCls[tone])} aria-hidden="true">
        {icon ?? <Icon />}
      </span>
      <h2 ref={ref} tabIndex={-1} className="mt-4 text-xl font-bold text-ink text-balance focus:outline-none">
        {title}
      </h2>
      {body && <div className="mt-2 max-w-sm text-[0.95rem] text-ink-2">{body}</div>}
      {children && <div className="mt-6 flex w-full flex-col items-stretch gap-2.5">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm', toneCls[tone])}>
      <Icon className="mt-0.5 shrink-0 text-base" aria-hidden="true" />
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}

export function PanelHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-[1.4rem] font-bold leading-tight text-ink text-balance">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[0.95rem] text-ink-2">{subtitle}</p>}
    </header>
  );
}

export function BookAgainLink({ slug }: { slug: string }) {
  const t = useT();
  return (
    <ButtonLink to={`/c/${encodeURIComponent(slug)}`} variant="secondary" size="lg" className="w-full" icon={<HiOutlineCalendarDays aria-hidden="true" />}>
      {t('pub.shell.bookAgain')}
    </ButtonLink>
  );
}

export function ClinicPhone({ clinic }: { clinic: ActionClinic }) {
  const t = useT();
  if (!clinic.phone) return null;
  return (
    <a
      href={`tel:${clinic.phone.replace(/[^\d+]/g, '')}`}
      data-no-underline
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 text-base font-medium text-ink shadow-sm hover:border-border-strong hover:bg-surface-2"
      aria-label={`${t('pub.shell.callClinic', { clinic: clinic.name })}: ${clinic.phone}`}
    >
      <HiOutlinePhone aria-hidden="true" /> {clinic.phone}
    </a>
  );
}

/** Friendly message for a failed POST that has no purpose-specific handling. */
export function actionErrorText(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t('pub.errors.networkBody');
    if (err.code === 'ACTION_LINK_USED') return t('pub.errors.usedBody');
    if (err.code === 'ACTION_LINK_EXPIRED') return t('pub.errors.expiredBody');
  }
  return t('pub.errors.genericBody');
}

export function InlineError({ error, clinic }: { error: unknown; clinic?: ActionClinic }) {
  const t = useT();
  if (!error) return null;
  const linkProblem = error instanceof ApiError && error.status === 410;
  return (
    <div role="alert" className="space-y-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
      <p className="flex items-start gap-2">
        <HiOutlineExclamationTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
        {actionErrorText(error, t)}
      </p>
      {linkProblem && clinic && <ClinicPhone clinic={clinic} />}
    </div>
  );
}
