import Lenis from 'lenis';
import { useEffect } from 'react';
import { gsap, ScrollTrigger } from './gsap';
import { useMotionEnabled } from './useMotion';

let current: Lenis | null = null;
/** The active Lenis instance (null when smooth scrolling is off). */
export const smoothScroller = () => current;

/**
 * Momentum smooth scrolling for marketing pages, driven by GSAP's ticker so scroll-linked
 * animations stay frame-perfect. Disabled for reduced motion, keyboard/anchor navigation still works.
 */
export function useSmoothScroll(): void {
  const motion = useMotionEnabled();
  useEffect(() => {
    if (!motion) return;
    const lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), anchors: { offset: -72 }, autoRaf: false });
    current = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    document.documentElement.classList.add('lenis-on');
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      current = null;
      document.documentElement.classList.remove('lenis-on');
    };
  }, [motion]);
}
