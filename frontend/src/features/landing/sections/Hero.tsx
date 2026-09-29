import { HiArrowRight, HiOutlineLockClosed } from 'react-icons/hi2';
import { ButtonLink } from '@/components/ui/Button';
import { useT } from '@/contexts/PreferencesContext';
import { AuroraCanvas } from '@/lib/motion/AuroraCanvas';
import { gsap, SplitText } from '@/lib/motion/gsap';
import { Magnetic } from '@/lib/motion/primitives';
import { useGsap } from '@/lib/motion/useMotion';
import { ProductMock } from './ProductMock';

/**
 * Cinematic opening: a live shader "tide" behind a masked headline reveal. As the page scrolls,
 * the copy drifts up and fades while the product mockup tilts from a 3D angle into place.
 */
export function Hero() {
  const t = useT();
  const ref = useGsap<HTMLElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const q = gsap.utils.selector(root);
      const split = SplitText.create(q('[data-hero-title]'), { type: 'lines,words', mask: 'lines', aria: 'auto', wordsClass: 'split-word' });
      // background-clip:text does not survive the split, so each gradient word paints its own gradient.
      root.querySelectorAll('.text-gradient-brand .split-word').forEach((w) => w.classList.add('text-gradient-brand'));
      const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
      intro
        .from(q('[data-hero-eyebrow]'), { y: 16, opacity: 0, duration: 0.8 })
        .from(split.words, { yPercent: 120, rotate: 5, duration: 1.3, stagger: 0.06 }, '-=0.5')
        .from(q('[data-hero-fade]'), { y: 24, opacity: 0, filter: 'blur(6px)', duration: 1, stagger: 0.1, clearProps: 'filter' }, '-=0.9')
        .from(q('[data-hero-mock]'), { y: 120, opacity: 0, duration: 1.6 }, '-=0.9');

      // Scroll-out of the copy and scroll-in of the product.
      gsap.to(q('[data-hero-copy]'), { yPercent: -35, opacity: 0, ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: '45% top', scrub: true } });
      gsap.fromTo(
        q('[data-hero-tilt]'),
        { rotateX: 24, scale: 0.86, y: 40 },
        { rotateX: 0, scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: q('[data-hero-mock]')[0], start: 'top 95%', end: 'top 25%', scrub: 0.8 } },
      );
      gsap.to(q('[data-hero-hint]'), { opacity: 0, scrollTrigger: { trigger: root, start: 'top top', end: '8% top', scrub: true } });
      return () => split.revert();
    },
    [t],
  );

  return (
    <section ref={ref} className="dark relative isolate overflow-hidden bg-[#060a17] pb-24 pt-32 text-ink sm:pt-40" aria-labelledby="hero-title">
      <AuroraCanvas className="-z-10" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-[0.12] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-b from-transparent to-[#060a17]" aria-hidden="true" />

      <div data-hero-copy className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
        <span data-hero-eyebrow className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/80 backdrop-blur">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          {t('landing.heroEyebrow')}
        </span>
        <h1 id="hero-title" data-hero-title className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-white text-balance sm:text-6xl lg:text-7xl">
          {t('landing.heroTitleA')} <span className="text-gradient-brand">{t('landing.heroTitleB')}</span>
        </h1>
        <p data-hero-fade className="mx-auto mt-6 max-w-2xl text-lg text-white/70 text-balance sm:text-xl">
          {t('landing.heroSubtitle')}
        </p>
        <div data-hero-fade className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Magnetic>
            <ButtonLink to="/register" size="lg" icon={<HiArrowRight aria-hidden="true" />} className="flex-row-reverse shadow-[0_10px_40px_-10px_rgba(129,140,248,.9)]">
              {t('landing.getStarted')}
            </ButtonLink>
          </Magnetic>
          <Magnetic>
            <ButtonLink to="/login" size="lg" variant="secondary" className="border-white/15 bg-white/5 text-white backdrop-blur hover:bg-white/10">
              {t('landing.bookDemo')}
            </ButtonLink>
          </Magnetic>
        </div>
        <p data-hero-fade className="mt-6 flex items-center justify-center gap-1.5 text-xs text-white/55">
          <HiOutlineLockClosed aria-hidden="true" /> {t('landing.trust')}
        </p>
      </div>

      <div data-hero-mock className="relative mt-16 px-4 [perspective:1600px] sm:mt-20 sm:px-6">
        <div data-hero-tilt className="origin-top [transform-style:preserve-3d]">
          <ProductMock />
        </div>
      </div>

      <div data-hero-hint className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-white/50 lg:flex" aria-hidden="true">
        {t('landing.scrollHint')}
        <span className="h-10 w-px overflow-hidden bg-white/15">
          <span className="block h-4 w-px animate-[scroll-hint_1.8s_ease-in-out_infinite] bg-white/70" />
        </span>
      </div>
    </section>
  );
}
