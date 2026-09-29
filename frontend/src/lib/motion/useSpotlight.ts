import { useEffect } from 'react';
import { useMotionEnabled } from './motionPref';

/**
 * One delegated listener for the whole app: feeds the pointer position to the `.spotlight`
 * element under the cursor through CSS variables (no React re-renders).
 */
export function useSpotlight(): void {
  const motion = useMotionEnabled();
  useEffect(() => {
    if (!motion || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = (e.target as Element | null)?.closest?.('.spotlight') as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [motion]);
}
