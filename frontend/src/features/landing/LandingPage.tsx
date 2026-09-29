import { useState } from 'react';
import { FaWhatsapp } from 'react-icons/fa6';
import {
  HiOutlineBookOpen,
  HiOutlineCalendarDays,
  HiOutlineChartBar,
  HiOutlineChatBubbleLeftRight,
  HiOutlineShieldCheck,
  HiOutlineSparkles,
  HiOutlineUserGroup,
  HiPlus,
} from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';
import { AgentAvatar, Logo } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { AuroraCanvas } from '@/lib/motion/AuroraCanvas';
import { CountUp, Magnetic, Marquee, Reveal, ScrollHighlight, ScrollProgress, SplitHeading, useRefreshOnLoad } from '@/lib/motion/primitives';
import { useSmoothScroll } from '@/lib/motion/SmoothScroll';
import { PricingGrid } from './PricingGrid';
import { AgentDemo } from './sections/AgentDemo';
import { FeatureGallery, type Feature } from './sections/FeatureGallery';
import { Hero } from './sections/Hero';
import { LandingHeader } from './sections/LandingHeader';
import { StackCards, type StackItem } from './sections/StackCards';

const INTEGRATIONS = ['WhatsApp Business', 'Google Calendar', 'Microsoft 365', 'OpenAI', 'Anthropic', 'Gemini', 'PostgreSQL · pgvector', 'Stripe', 'Twilio SMS', 'Resend', 'Web chat', 'PWA'];

export default function LandingPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const nav = useNavigate();
  const [interval, setInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  useSmoothScroll();
  useRefreshOnLoad();

  const features: Feature[] = [
    { icon: HiOutlineSparkles, title: t('landing.f1'), body: t('landing.f1d') },
    { icon: HiOutlineCalendarDays, title: t('landing.f2'), body: t('landing.f2d') },
    { icon: FaWhatsapp, title: t('landing.f3'), body: t('landing.f3d') },
    { icon: HiOutlineBookOpen, title: t('landing.f4'), body: t('landing.f4d') },
    { icon: HiOutlineUserGroup, title: t('landing.f5'), body: t('landing.f5d') },
    { icon: HiOutlineChatBubbleLeftRight, title: t('landing.f6'), body: t('landing.f6d') },
    { icon: HiOutlineChartBar, title: t('landing.f7'), body: t('landing.f7d') },
    { icon: HiOutlineShieldCheck, title: t('landing.f8'), body: t('landing.f8d') },
  ];
  const stack: StackItem[] = [
    { icon: HiOutlineChatBubbleLeftRight, title: t('landing.f6'), body: t('landing.f6d'), points: [t('landing.s1a'), t('landing.s1b'), t('landing.s1c')], tint: 'bg-primary-soft text-primary' },
    { icon: HiOutlineBookOpen, title: t('landing.f4'), body: t('landing.f4d'), points: [t('landing.s2a'), t('landing.s2b'), t('landing.s2c')], tint: 'bg-accent-soft text-accent-strong dark:text-accent' },
    { icon: HiOutlineChartBar, title: t('landing.f7'), body: t('landing.f7d'), points: [t('landing.s3a'), t('landing.s3b'), t('landing.s3c')], tint: 'bg-warning-soft text-warning' },
    { icon: HiOutlineShieldCheck, title: t('landing.f8'), body: t('landing.f8d'), points: [t('landing.s4a'), t('landing.s4b'), t('landing.s4c')], tint: 'bg-info-soft text-info' },
  ];
  const faqs = [1, 2, 3, 4, 5].map((i) => ({ q: t(`landing.faq${i}q` as never), a: t(`landing.faq${i}a` as never) }));
  const locale = prefs.lang === 'en' ? 'en-US' : 'es-CO';

  return (
    <div className="min-h-dvh bg-bg">
      <a href="#main" className="sr-only z-[70] rounded-lg bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t('common.skipToContent')}
      </a>
      <ScrollProgress />
      <LandingHeader />

      <main id="main">
        <Hero />

        {/* Integrations ticker */}
        <section className="border-b border-border bg-bg py-12" aria-label={t('landing.marqueeTitle')}>
          <p className="mb-7 text-center text-xs font-semibold uppercase tracking-[0.22em] text-ink-3">{t('landing.marqueeTitle')}</p>
          <Marquee speed={42}>
            {INTEGRATIONS.map((name) => (
              <span key={name} className="flex items-center gap-12 whitespace-nowrap font-display text-xl font-semibold text-ink-3 sm:text-2xl">
                {name}
                <span className="h-1.5 w-1.5 rounded-full bg-border-strong" aria-hidden="true" />
              </span>
            ))}
          </Marquee>
        </section>

        {/* Statement — words light up with scroll */}
        <section className="mx-auto max-w-5xl px-4 py-28 sm:px-6 sm:py-40">
          <ScrollHighlight text={t('landing.statement')} className="font-display text-3xl font-semibold leading-[1.18] tracking-tight text-ink sm:text-5xl" />
        </section>

        <AgentDemo />

        <FeatureGallery features={features} />

        <StackCards items={stack} />

        {/* Numbers */}
        <section className="border-y border-border bg-surface" aria-labelledby="stats-h">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24">
            <SplitHeading id="stats-h" className="mx-auto max-w-2xl text-center font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {t('landing.statsTitle')}
            </SplitHeading>
            <Reveal as="dl" className="mt-14 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
              {[
                { v: 24, label: t('landing.statTools') },
                { v: 31, label: t('landing.statPerms') },
                { v: 2, label: t('landing.statLangs') },
                { v: 24, suffix: '/7', label: t('landing.statHours') },
              ].map((s) => (
                <div key={s.label} data-reveal className="flex flex-col-reverse text-center">
                  <dt className="mt-2 text-sm text-ink-2">{s.label}</dt>
                  <dd className="bg-gradient-to-b from-ink to-ink-3 bg-clip-text font-display text-6xl font-extrabold tracking-tight text-transparent sm:text-7xl">
                    <CountUp value={s.v} suffix={s.suffix} locale={locale} />
                  </dd>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32" aria-labelledby="pricing-h">
          <div className="mb-12 text-center">
            <SplitHeading id="pricing-h" className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('landing.pricingTitle')}
            </SplitHeading>
            <Reveal>
              <p className="mt-4 text-ink-2">{t('landing.pricingSubtitle')}</p>
            </Reveal>
          </div>
          <Reveal y={40}>
            <PricingGrid interval={interval} onInterval={setInterval} onChoose={() => nav('/register')} />
          </Reveal>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-28 sm:px-6" aria-labelledby="faq-h">
          <SplitHeading id="faq-h" className="mb-10 text-center font-display text-4xl font-bold tracking-tight">
            {t('landing.faqTitle')}
          </SplitHeading>
          <Reveal className="space-y-3" stagger={0.07}>
            {faqs.map((f) => (
              <details key={f.q} data-reveal className="spotlight group rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors open:border-border-strong [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {f.q}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-ink-2 transition-transform duration-300 group-open:rotate-45" aria-hidden="true">
                    <HiPlus />
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </Reveal>
        </section>

        {/* Closing CTA */}
        <section className="px-4 pb-24 sm:px-6">
          <div className="dark relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-20 text-center sm:py-28">
            <AuroraCanvas palette="deep" intensity={1.15} className="-z-10" />
            <AgentAvatar size={64} className="mx-auto" online />
            <SplitHeading className="mx-auto mt-6 max-w-2xl font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">{t('landing.ctaTitle')}</SplitHeading>
            <Reveal>
              <p className="mx-auto mt-5 max-w-xl text-lg text-white/70">{t('landing.ctaBody')}</p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Magnetic>
                  <ButtonLink to="/register" size="lg" variant="accent">
                    {t('landing.getStarted')}
                  </ButtonLink>
                </Magnetic>
                <Magnetic>
                  <ButtonLink to="/login" size="lg" variant="secondary" className="border-white/15 bg-white/5 text-white backdrop-blur hover:bg-white/10">
                    {t('landing.tryDemo')}
                  </ButtonLink>
                </Magnetic>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-ink-3 sm:flex-row sm:px-6">
          <Logo showSub />
          <p>{t('landing.footer', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
    </div>
  );
}
