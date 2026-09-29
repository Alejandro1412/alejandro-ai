import { useEffect, useState } from 'react';
import { usePreferences } from '@/contexts/PreferencesContext';

const query = '(prefers-reduced-motion: reduce)';

/**
 * Motion is on unless the person asked for less of it — either in the OS or in our own
 * accessibility panel. Every effect in the app checks this before animating.
 */
export function useMotionEnabled(): boolean {
  const { prefs } = usePreferences();
  const [osReduce, setOsReduce] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setOsReduce(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return !prefs.reduceMotion && !osReduce;
}
