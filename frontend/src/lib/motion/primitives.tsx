import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/format';
import { gsap, ScrollTrigger, SplitText } from './gsap';
import { useGsap, useMotionEnabled } from './useMotion';

/** Fades/lifts its children (or `[data-reveal]` descendants, staggered) the first time they enter the viewport. */
export function Reveal({
  children,
  as: As = 'div',
  className,
  y = 28,
  delay = 0,
  stagger = 0.08,
  blur = true,
  start = 'top 85%',
  ...rest
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  y?: number;
  delay?: number;
  stagger?: number;
  blur?: boolean;
  start?: string;
  id?: string;
  'aria-labelledby'?: string;
}) {
  const ref = useGsap<HTMLElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const items = root.querySelectorAll<HTMLElement>('[data-reveal]');
      const targets = items.length ? Array.from(items) : [root];
      gsap.from(targets, {
        y,
        opacity: 0,
        filter: blur ? 'blur(8px)' : 'none',
        duration: 1,
        delay,
        stagger,
        clearProps: 'filter,transform',
        scrollTrigger: { trigger: root, start, once: true },
      });
    },
    [y, delay, stagger, blur, start],
  );
  return (
    <As ref={ref} className={className} {...rest}>
      {children}
    </As>
  );
}

/**
 * Headline that rises in word-by-word from behind a mask. SplitText keeps an aria-label with the
 * full sentence so screen readers never hear fragments.
 */
export function SplitHeading({ as: As = 'h2', children, className, id, scroll = true, delay = 0 }: { as?: ElementType; children: ReactNode; className?: string; id?: string; scroll?: boolean; delay?: number }) {
  const ref = useGsap<HTMLElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const split = SplitText.create(root, { type: 'lines,words', mask: 'lines', aria: 'auto' });
      gsap.from(split.words, {
        yPercent: 110,
        rotate: 4,
        opacity: 0,
        duration: 1.1,
        ease: 'expo.out',
        stagger: 0.045,
        delay,
        scrollTrigger: scroll ? { trigger: root, start: 'top 88%', once: true } : undefined,
      });
      return () => split.revert();
    },
    [scroll, delay],
  );
  return (
    <As ref={ref} id={id} className={className}>
      {children}
    </As>
  );
}

/** Paragraph whose words light up one after another as it scrolls through the viewport (scrubbed). */
export function ScrollHighlight({ text, className }: { text: string; className?: string }) {
  const ref = useGsap<HTMLParagraphElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const split = SplitText.create(root, { type: 'words', aria: 'auto' });
      gsap.fromTo(split.words, { opacity: 0.16 }, { opacity: 1, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: root, start: 'top 80%', end: 'bottom 45%', scrub: 0.6 } });
      return () => split.revert();
    },
    [text],
  );
  return (
    <p ref={ref} className={className}>
      {text}
    </p>
  );
}

/** Moves content at a different speed than the scroll (depth). `speed` is the travel in % of its height. */
export function Parallax({ children, speed = 12, className, style }: { children: ReactNode; speed?: number; className?: string; style?: CSSProperties }) {
  const ref = useGsap<HTMLDivElement>(
    ({ root, motion }) => {
      if (!motion) return;
      gsap.fromTo(root, { yPercent: speed }, { yPercent: -speed, ease: 'none', scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: true } });
    },
    [speed],
  );
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

/** Pulls its child toward the pointer (fine pointers only), springing back on leave. */
export function Magnetic({ children, strength = 0.35, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motion = useMotionEnabled();
  useEffect(() => {
    const el = ref.current;
    if (!el || !motion || !window.matchMedia('(pointer: fine)').matches) return;
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => {
      xTo(0);
      yTo(0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      gsap.set(el, { x: 0, y: 0 });
    };
  }, [motion, strength]);
  return (
    <span ref={ref} className={cn('inline-flex will-change-transform', className)}>
      {children}
    </span>
  );
}

/** Counts from 0 to `value` when it scrolls into view. Screen readers get the final value immediately. */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', className, locale }: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string; locale?: string }) {
  const motion = useMotionEnabled();
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => `${prefix}${n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  const [shown, setShown] = useState(() => (motion ? fmt(0) : fmt(value)));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!motion) {
      setShown(fmt(value));
      return;
    }
    const state = { n: 0 };
    const tween = gsap.to(state, {
      n: value,
      duration: 1.6,
      ease: 'power2.out',
      onUpdate: () => setShown(fmt(state.n)),
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fmt depends only on the listed props
  }, [value, motion, decimals, prefix, suffix, locale]);
  return (
    <span className={className}>
      <span aria-hidden="true" ref={ref} className="tabular-nums">
        {shown}
      </span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  );
}

/** Infinite, pausable ticker. The duplicate track is hidden from assistive tech. */
export function Marquee({ children, className, speed = 38, reverse }: { children: ReactNode; className?: string; speed?: number; reverse?: boolean }) {
  return (
    <div className={cn('marquee group relative flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]', className)}>
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden={i === 1 || undefined}
          className="marquee-track flex shrink-0 items-center gap-12 pr-12 group-hover:[animation-play-state:paused]"
          style={{ animationDuration: `${speed}s`, animationDirection: reverse ? 'reverse' : 'normal' }}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

/** Thin progress bar bound to page scroll. */
export function ScrollProgress() {
  const ref = useGsap<HTMLDivElement>(({ root, motion }) => {
    if (!motion) return;
    gsap.fromTo(root, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });
  }, []);
  return <div ref={ref} aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left scale-x-0 bg-gradient-to-r from-primary via-accent to-primary motion-reduce:hidden" />;
}

/** Recomputes trigger positions once fonts/images settle (layout shifts after first paint). */
export function useRefreshOnLoad(): void {
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();
    void document.fonts?.ready.then(refresh);
    window.addEventListener('load', refresh);
    return () => window.removeEventListener('load', refresh);
  }, []);
}
