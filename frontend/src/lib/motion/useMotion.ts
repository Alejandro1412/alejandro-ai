import { useEffect, useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';
import { gsap } from './gsap';
import { useMotionEnabled } from './motionPref';

export { useMotionEnabled };

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Runs GSAP code scoped to a container and reverts every tween/ScrollTrigger on cleanup,
 * so route changes and StrictMode double-mounts never leak animations.
 */
export function useGsap<T extends HTMLElement>(setup: (ctx: { root: T; motion: boolean }) => void | (() => void), deps: DependencyList, enabled = true): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const motion = useMotionEnabled();
  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let extra: void | (() => void);
    const ctx = gsap.context(() => {
      extra = setup({ root, motion });
    }, root);
    return () => {
      if (typeof extra === 'function') extra();
      ctx.revert();
    };
  }, [motion, enabled, ...deps]);
  return ref;
}
