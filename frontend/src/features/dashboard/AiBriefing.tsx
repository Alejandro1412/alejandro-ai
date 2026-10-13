import type { IconType } from 'react-icons';
import { HiArrowRight, HiOutlineBookOpen, HiOutlineCalendarDays, HiOutlineFaceSmile, HiOutlineSparkles, HiOutlineUserGroup } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { AgentAvatar } from '@/components/brand/Logo';
import { RichText } from '@/components/chat/RichText';
import { useT } from '@/contexts/PreferencesContext';
import { AuroraCanvas } from '@/lib/motion/AuroraCanvas';

export interface BriefingData {
  todayAppointments: { value: number; completed: number };
  aiConversations: { value: number };
  appointmentsBookedByAi: { value: number };
  aiResolutionRate: { value: number };
  humanHandoffs: { open: number };
  satisfaction?: { positive: number; negative: number; rate: number | null };
}

/**
 * "What matters today" written by the assistant from real analytics — never invented: every line is
 * a number from the API, with a link to act on it.
 */
export function AiBriefing({ o, unanswered, days }: { o: BriefingData; unanswered: string | null; days: number }) {
  const t = useT();
  const items: { icon: IconType; text: string; to?: string; cta?: string }[] = [
    {
      icon: HiOutlineCalendarDays,
      text: t('dashboard.b1', { count: o.todayAppointments.value }) + (o.todayAppointments.completed ? t('dashboard.b1done', { count: o.todayAppointments.completed }) : ''),
      to: '/calendar',
      cta: t('nav.calendar'),
    },
    {
      icon: HiOutlineSparkles,
      text: t('dashboard.b2', { rate: o.aiResolutionRate.value, count: o.aiConversations.value, booked: o.appointmentsBookedByAi.value, days }),
    },
    o.humanHandoffs.open
      ? { icon: HiOutlineUserGroup, text: t('dashboard.b3', { count: o.humanHandoffs.open }), to: '/conversations?tab=queue', cta: t('dashboard.viewQueue') }
      : { icon: HiOutlineUserGroup, text: t('dashboard.b3none') },
    ...(unanswered ? [{ icon: HiOutlineBookOpen, text: t('dashboard.b4', { q: unanswered.slice(0, 90) }), to: '/knowledge', cta: t('dashboard.addKnowledge') }] : []),
    ...(o.satisfaction?.rate != null ? [{ icon: HiOutlineFaceSmile, text: t('dashboard.b5', { rate: o.satisfaction.rate, count: o.satisfaction.positive + o.satisfaction.negative }) }] : []),
  ];
  return (
    <section aria-labelledby="briefing-h" className="dark relative isolate overflow-hidden rounded-2xl border border-white/10 text-ink shadow-pop">
      <AuroraCanvas palette="deep" intensity={0.55} className="-z-10" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#060a17]/90 via-[#060a17]/70 to-[#060a17]/30" aria-hidden="true" />
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-3">
            <AgentAvatar size={40} online />
            <div>
              <h2 id="briefing-h" className="font-display text-lg font-bold text-white">
                {t('dashboard.briefingTitle')}
              </h2>
              <p className="text-xs text-white/60">{t('dashboard.briefingSubtitle')}</p>
            </div>
          </div>
          <ul className="stagger mt-4 grid gap-2.5 md:grid-cols-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/85 backdrop-blur">
                <it.icon className="mt-0.5 shrink-0 text-base text-accent" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <RichText text={it.text} className="[&_strong]:text-white" />
                  {it.to && (
                    <Link to={it.to} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#a5b4fc] hover:text-white" data-no-underline>
                      {it.cta} <HiArrowRight aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <Link to="/ai/playground" className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#1e1b4b] shadow-lg transition hover:-translate-y-0.5 lg:self-center" data-no-underline>
          <HiOutlineSparkles aria-hidden="true" /> {t('dashboard.openPlayground')}
        </Link>
      </div>
    </section>
  );
}
