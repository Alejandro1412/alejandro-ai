import { HiCheckCircle, HiOutlineCalendarDays } from 'react-icons/hi2';
import { AgentAvatar } from '@/components/brand/Logo';
import { usePreferences, useT, type TKey } from '@/contexts/PreferencesContext';
import { gsap } from '@/lib/motion/gsap';
import { SplitHeading } from '@/lib/motion/primitives';
import { useGsap } from '@/lib/motion/useMotion';

const STEPS: [TKey, TKey][] = [
  ['landing.step1', 'landing.step1d'],
  ['landing.step2', 'landing.step2d'],
  ['landing.step3', 'landing.step3d'],
  ['landing.step4', 'landing.step4d'],
  ['landing.step5', 'landing.step5d'],
];

/**
 * Scroll-driven walkthrough of one real agent turn. On large screens the section pins and the
 * scroll position scrubs a timeline: each step lights up while the conversation and the agent
 * trace build up beside it. On phones (or with reduced motion) everything is shown statically.
 */
export function AgentDemo() {
  const t = useT();
  const { prefs } = usePreferences();
  const es = prefs.lang !== 'en';

  const ref = useGsap<HTMLElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        const q = gsap.utils.selector(root);
        const steps = q('[data-step]');
        const bars = q('[data-step-bar]');
        gsap.set(q('[data-chat], [data-trace]'), { autoAlpha: 0, y: 18 });
        gsap.set(steps, { opacity: 0.35 });
        gsap.set(bars, { scaleY: 0 });

        const tl = gsap.timeline({
          defaults: { ease: 'power2.out', duration: 1 },
          scrollTrigger: { trigger: q('[data-pin]')[0], start: 'top top', end: '+=320%', pin: true, scrub: 0.8, anticipatePin: 1 },
        });
        const show = (sel: string) => tl.to(q(sel), { autoAlpha: 1, y: 0, stagger: 0.35 }, '<0.2');
        const step = (i: number) => {
          tl.to(steps, { opacity: (k: number) => (k === i ? 1 : k < i ? 0.6 : 0.35), duration: 0.4 });
          tl.to(bars[i], { scaleY: 1, duration: 1.2 }, '<');
        };

        step(0);
        show('[data-chat="1"], [data-trace="1"]');
        step(1);
        show('[data-trace="2"]');
        step(2);
        show('[data-trace="3"], [data-trace="4"], [data-chat="2"], [data-chat="3"]');
        step(3);
        show('[data-chat="4"], [data-trace="5"]');
        tl.to(q('[data-slot-picked]'), { backgroundColor: 'rgb(129 140 248)', color: '#0c1028', duration: 0.4 }, '<');
        step(4);
        show('[data-chat="5"], [data-trace="6"]');
        tl.to({}, { duration: 0.6 }); // hold on the final frame
      });
      return () => mm.revert();
    },
    [prefs.lang],
  );

  const slots = es ? ['Jue 10:30', 'Vie 8:00', 'Vie 15:00'] : ['Thu 10:30', 'Fri 8:00', 'Fri 15:00'];

  return (
    <section ref={ref} id="product" className="dark relative bg-[#070b1a] text-ink" aria-labelledby="demo-h">
      <div data-pin className="relative flex min-h-screen items-center overflow-hidden py-24 lg:py-0">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[120px]" aria-hidden="true" />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">{t('landing.demoEyebrow')}</p>
            <SplitHeading id="demo-h" className="mt-3 font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl">
              {t('landing.demoTitle')}
            </SplitHeading>
            <ol className="mt-10 space-y-5">
              {STEPS.map(([title, body], i) => (
                <li key={title} data-step className="flex gap-4">
                  <span className="relative mt-0.5 flex w-8 shrink-0 flex-col items-center">
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-white/5 font-mono text-xs text-white">{i + 1}</span>
                    {i < STEPS.length - 1 && (
                      <span className="mt-1 h-9 w-px bg-white/10">
                        <span data-step-bar className="block h-full w-px origin-top bg-gradient-to-b from-primary to-accent" />
                      </span>
                    )}
                  </span>
                  <span>
                    <span className="block font-semibold text-white">{t(title)}</span>
                    <span className="mt-0.5 block text-sm text-white/60">{t(body)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]" aria-hidden="true">
            <div className="rounded-[1.75rem] border border-white/10 bg-surface/80 p-4 shadow-[0_30px_100px_-30px_rgba(99,102,241,.6)] backdrop-blur">
              <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
                <AgentAvatar size={30} online />
                <div>
                  <p className="text-sm font-semibold text-white">Alejandro AI</p>
                  <p className="text-[0.68rem] text-white/50">NovaCare Medical Center</p>
                </div>
              </div>
              <div className="space-y-3 pt-4 text-[0.82rem]">
                <p data-chat="1" className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-fg">
                  {t('landing.mockChatUser')}
                </p>
                <p data-chat="2" className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-surface-2 px-3.5 py-2 text-white/90">
                  {t('landing.mockChatAi')}
                </p>
                <div data-chat="3" className="grid grid-cols-3 gap-2">
                  {slots.map((s, i) => (
                    <span key={s} {...(i === 1 ? { 'data-slot-picked': true } : {})} className="rounded-xl border border-white/10 bg-surface-2 px-2 py-2 text-center text-xs font-semibold text-white">
                      {s}
                    </span>
                  ))}
                </div>
                <p data-chat="4" className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-fg">
                  {t('landing.demoPick')}
                </p>
                <div data-chat="5" className="space-y-2">
                  <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-surface-2 px-3.5 py-2 text-white/90">{t('landing.demoConfirmed')}</p>
                  <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-3">
                    <HiCheckCircle className="mt-0.5 text-lg text-success" />
                    <div>
                      <p className="text-sm font-semibold text-white">{t('landing.demoCardTitle')}</p>
                      <p className="text-xs text-white/70">{t('landing.demoCardBody')}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-white/60">
                        <HiOutlineCalendarDays /> {t('landing.demoCardWhen')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="self-start rounded-2xl border border-white/10 bg-black/40 p-4 font-mono text-[0.72rem] leading-relaxed text-white/70 backdrop-blur">
              <p className="mb-2 text-white/40">// agent trace</p>
              <p data-trace="1">
                intent <span className="text-[#a5b4fc]">book_appointment</span> · 0.90
              </p>
              <p data-trace="2">
                policy <span className="text-[#5eead4]">normal</span> · safety ✓
              </p>
              <p data-trace="3">
                → getDoctors <span className="text-white/40">dermatología</span> <span className="text-success">18ms</span>
              </p>
              <p data-trace="4">
                → getAvailableAppointmentSlots <span className="text-success">42ms</span>
              </p>
              <p data-trace="5">
                → createAppointment <span className="text-success">CONFIRMED 61ms</span>
              </p>
              <p data-trace="6" className="text-white/45">
                audit ✓ · tokens 2,184→96 · $0.0004
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
