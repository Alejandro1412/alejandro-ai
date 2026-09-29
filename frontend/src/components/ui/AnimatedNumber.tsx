import { useEffect, useRef, useState } from 'react';
import { useMotionEnabled } from '@/lib/motion/motionPref';

/**
 * Counts up to `to` (ease-out, ~0.9 s) on mount and whenever the value changes. Lightweight
 * (requestAnimationFrame, no animation library) so it can live in the main bundle. Assistive tech
 * always receives the final formatted value.
 */
export function AnimatedNumber({ to, format, durationMs = 900 }: { to: number; format: (n: number) => string; durationMs?: number }) {
  const motion = useMotionEnabled();
  const [n, setN] = useState(motion ? 0 : to);
  const from = useRef(0);
  useEffect(() => {
    if (!motion) {
      setN(to);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(origin + (to - origin) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = to;
    };
  }, [to, motion, durationMs]);
  const decimals = Number.isInteger(to) ? 0 : 1;
  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {format(Number(n.toFixed(decimals)))}
      </span>
      <span className="sr-only">{format(to)}</span>
    </>
  );
}
