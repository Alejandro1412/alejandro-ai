import type { IconType } from 'react-icons';
import { useT } from '@/contexts/PreferencesContext';
import { gsap } from '@/lib/motion/gsap';
import { SplitHeading } from '@/lib/motion/primitives';
import { useGsap } from '@/lib/motion/useMotion';

export interface Feature {
  icon: IconType;
  title: string;
  body: string;
}

const GLOWS = ['from-primary/35', 'from-accent/35', 'from-[#a855f7]/30', 'from-[#0ea5e9]/30'];

/**
 * Horizontal gallery: on desktop the section pins and vertical scroll pans the cards sideways
 * (with a slight depth tilt on each card); on touch devices it is a native swipeable, snapping row.
 */
export function FeatureGallery({ features }: { features: Feature[] }) {
  const t = useT();
  const ref = useGsap<HTMLElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        const track = root.querySelector<HTMLElement>('[data-track]')!;
        const viewport = track.parentElement!;
        viewport.style.overflow = 'visible'; // the pin drives the pan; native scrolling is the fallback
        const distance = () => track.scrollWidth - window.innerWidth + 48;
        const pan = gsap.to(track, {
          x: () => -distance(),
          ease: 'none',
          scrollTrigger: { trigger: root, start: 'top top', end: () => `+=${distance()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1 },
        });
        gsap.utils.toArray<HTMLElement>('[data-card]', root).forEach((card) => {
          gsap.fromTo(
            card,
            { rotateY: -14, scale: 0.92, opacity: 0.5 },
            { rotateY: 0, scale: 1, opacity: 1, ease: 'none', scrollTrigger: { trigger: card, containerAnimation: pan, start: 'left 100%', end: 'left 55%', scrub: true } },
          );
        });
        return () => {
          viewport.style.overflow = '';
        };
      });
      return () => mm.revert();
    },
    [features.length],
  );

  return (
    <section ref={ref} className="relative overflow-hidden bg-bg py-24 lg:flex lg:min-h-screen lg:flex-col lg:justify-center lg:py-0" aria-labelledby="gallery-h">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{t('landing.galleryEyebrow')}</p>
        <SplitHeading id="gallery-h" className="mt-3 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          {t('landing.galleryTitle')}
        </SplitHeading>
      </div>
      <div className="mt-12 overflow-x-auto [perspective:1400px] [scroll-snap-type:x_mandatory] [scrollbar-width:none]">
        <ul data-track className="flex w-max gap-5 px-4 pb-4 sm:px-6 lg:pl-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))]">
          {features.map((f, i) => (
            <li
              key={f.title}
              data-card
              className="spotlight group relative flex h-[380px] w-[78vw] max-w-[380px] shrink-0 snap-start flex-col overflow-hidden rounded-[1.75rem] border border-border bg-surface p-7 shadow-card sm:h-[420px]"
            >
              <div className={`pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br ${GLOWS[i % GLOWS.length]} to-transparent blur-2xl transition-transform duration-700 group-hover:scale-125`} aria-hidden="true" />
              <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              <span className="mt-6 grid h-14 w-14 place-items-center rounded-2xl border border-border bg-surface-2 text-2xl text-primary transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110">
                <f.icon aria-hidden="true" />
              </span>
              <h3 className="mt-auto font-display text-2xl font-bold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
