import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { HiOutlineArrowPath, HiOutlineClock, HiOutlineLinkSlash, HiOutlineLockClosed, HiOutlineNoSymbol, HiOutlineSignalSlash } from 'react-icons/hi2';
import { Link, useParams } from 'react-router-dom';
import { Isotype } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Feedback';
import { DEFAULT_PREFS, usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { LangSwitch, ThemeMenu } from '@/layouts/Controls';
import { actionKey, CancelPanel, ConfirmPanel, PaymentPanel } from './AppointmentPanels';
import { classifyLoadError, pickLinkLanguage, type LoadProblem } from './helpers';
import { IntakePanel } from './IntakePanel';
import { ClinicMark, ResultState } from './parts';
import { ReviewPanel } from './ReviewPanel';
import type { ActionInfo, PanelProps } from './types';
import { WaitlistPanel } from './WaitlistPanel';

/** Remembers the language this page applied automatically, so a later manual choice is not overridden. */
const AUTO_LANG_KEY = 'aai.actions.autoLang';
const readAutoLang = () => {
  try {
    return localStorage.getItem(AUTO_LANG_KEY);
  } catch {
    return null;
  }
};
const writeAutoLang = (lang: string) => {
  try {
    localStorage.setItem(AUTO_LANG_KEY, lang);
  } catch {
    /* storage unavailable */
  }
};

/**
 * Public page behind every patient link (/a/:token): confirm, cancel, waitlist offer, intake form,
 * review and deposit payment. No login: the token is the credential, so requests are anonymous.
 */
export default function ActionPage() {
  const { token = '' } = useParams();
  const t = useT();
  const { prefs, setPrefs } = usePreferences();
  const q = useQuery({
    queryKey: actionKey(token),
    queryFn: () => api.request<ActionInfo>(`/public/actions/${encodeURIComponent(token)}`, { anonymous: true }).then((r) => r.data),
    // Single-use links are consumed by the action: never refetch behind the patient's back.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: Boolean(token),
  });
  const info = q.data;

  // Use the appointment language once, unless the visitor picked a language themselves.
  const langApplied = useRef(false);
  useEffect(() => {
    if (!info || langApplied.current) return;
    langApplied.current = true;
    const next = pickLinkLanguage(info.appointment?.language, prefs.lang, DEFAULT_PREFS.lang, readAutoLang());
    if (next) {
      writeAutoLang(next);
      setPrefs({ lang: next });
    }
  }, [info, prefs.lang, setPrefs]);

  let body: ReactNode;
  if (!token) body = <LoadError problem="not_found" />;
  else if (info) body = <Panel token={token} info={info} />;
  else if (q.isError) body = <LoadError problem={classifyLoadError(q.error)} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  else body = <LoadingCard />;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 pb-2 pt-4 sm:pt-8">
        {info ? (
          <>
            <ClinicMark name={info.clinic.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold text-ink">{info.clinic.name}</p>
              <p className="flex items-center gap-1 text-xs text-ink-3">
                <HiOutlineLockClosed aria-hidden="true" /> {t('pub.shell.secureLink')}
              </p>
            </div>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Isotype size={40} />
            <span className="font-display font-bold text-ink">Alejandro AI</span>
          </div>
        )}
        <div className="flex shrink-0 items-center">
          <LangSwitch compact />
          <ThemeMenu />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-lg flex-1 px-4 py-4">
        <div className="card page-enter p-5 sm:p-7" aria-busy={q.isLoading || undefined}>
          {body}
        </div>
        {info && (
          <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-xs text-ink-3">
            <HiOutlineLockClosed className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t('pub.shell.secureNote')} {t('pub.shell.validUntil', { date: fmtDate(info.expiresAt, prefs.lang, info.clinic.timezone) })}
            </span>
          </p>
        )}
      </main>

      <footer className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-between gap-3 px-4 pb-6 pt-2 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          {t('pub.shell.poweredBy')} <Isotype size={16} /> <span className="font-semibold text-ink-2">Alejandro AI</span>
        </span>
        <nav className="flex gap-3" aria-label={t('pub.legal.otherDocs')}>
          <Link to={`/legal/privacy${info ? `?clinic=${encodeURIComponent(info.clinic.slug)}` : ''}`} className="hover:text-ink hover:underline">
            {t('pub.shell.privacy')}
          </Link>
          <Link to="/legal/terms" className="hover:text-ink hover:underline">
            {t('pub.shell.terms')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}

function Panel(props: PanelProps) {
  const { info } = props;
  const hasAppointment = Boolean(info.appointment);
  switch (info.purpose) {
    case 'confirm':
      return hasAppointment ? <ConfirmPanel {...props} /> : <LoadError problem="other" />;
    case 'cancel':
      return hasAppointment ? <CancelPanel {...props} /> : <LoadError problem="other" />;
    case 'payment':
      return hasAppointment ? <PaymentPanel {...props} /> : <LoadError problem="other" />;
    case 'waitlist':
      return info.offer ? <WaitlistPanel {...props} /> : <LoadError problem="other" />;
    case 'intake':
      return <IntakePanel {...props} />;
    case 'review':
      return <ReviewPanel {...props} />;
    default:
      return <LoadError problem="not_found" />;
  }
}

function LoadingCard() {
  const t = useT();
  return (
    <div role="status" aria-label={t('pub.shell.loading')} className="space-y-4">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <span className="sr-only">{t('pub.shell.loading')}</span>
    </div>
  );
}

function LoadError({ problem, onRetry, retrying }: { problem: LoadProblem; onRetry?: () => void; retrying?: boolean }) {
  const t = useT();
  const content = {
    not_found: { icon: <HiOutlineLinkSlash />, title: t('pub.errors.notFoundTitle'), body: t('pub.errors.notFoundBody') },
    used: { icon: <HiOutlineNoSymbol />, title: t('pub.errors.usedTitle'), body: t('pub.errors.usedBody') },
    expired: { icon: <HiOutlineClock />, title: t('pub.errors.expiredTitle'), body: t('pub.errors.expiredBody') },
    network: { icon: <HiOutlineSignalSlash />, title: t('pub.errors.networkTitle'), body: t('pub.errors.networkBody') },
    other: { icon: undefined, title: t('pub.errors.genericTitle'), body: t('pub.errors.genericBody') },
  }[problem];
  const retryable = problem === 'network' || problem === 'other';
  return (
    <ResultState tone={problem === 'network' || problem === 'other' ? 'danger' : 'warning'} icon={content.icon} title={content.title} body={content.body}>
      {retryable && onRetry && (
        <Button size="lg" className="w-full" loading={retrying} icon={<HiOutlineArrowPath aria-hidden="true" />} onClick={onRetry}>
          {t('pub.errors.retry')}
        </Button>
      )}
    </ResultState>
  );
}
