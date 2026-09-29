import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from '@/i18n/en';
import { es, type Dictionary } from '@/i18n/es';

export type ThemePref = 'light' | 'dark' | 'system';
export type Lang = 'es' | 'en';

export interface Preferences {
  theme: ThemePref;
  lang: Lang;
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
  readableFont: boolean;
  underlineLinks: boolean;
  readAloud: boolean;
}

const KEY = 'aai.prefs';
const browserLang = (): Lang => (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es');
export const DEFAULT_PREFS: Preferences = {
  theme: 'system',
  lang: browserLang(),
  fontScale: 1,
  highContrast: false,
  reduceMotion: false,
  readableFont: false,
  underlineLinks: false,
  readAloud: false,
};

/** Preferences are per-device conveniences; storage may be unavailable, so every access is guarded. */
function load(): Preferences {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Preferences>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

type Leaves<T, P extends string = ''> = {
  [K in keyof T & (string | number)]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & (string | number)];
export type TKey = Leaves<Dictionary>;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

interface Ctx {
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;
  reset: () => void;
  resolvedTheme: 'light' | 'dark';
  t: TFn;
  dict: Dictionary;
}

const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Preferences>(load);
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolvedTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.classList.toggle('hc', prefs.highContrast);
    root.classList.toggle('reduce-motion', prefs.reduceMotion);
    root.classList.toggle('readable-font', prefs.readableFont);
    root.classList.toggle('underline-links', prefs.underlineLinks);
    root.style.setProperty('--font-scale', String(prefs.fontScale));
    root.lang = prefs.lang;
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', resolvedTheme === 'dark' ? '#080d1a' : '#4f46e5');
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable (private mode) — preferences still apply for this session */
    }
  }, [prefs, resolvedTheme]);

  const setPrefs = useCallback((patch: Partial<Preferences>) => setState((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setState({ ...DEFAULT_PREFS, lang: prefs.lang }), [prefs.lang]);
  const dict = prefs.lang === 'en' ? en : es;

  const t = useCallback<TFn>(
    (key, vars) => {
      const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
      let out = typeof value === 'string' ? value : key;
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
      return out;
    },
    [dict],
  );

  const value = useMemo(() => ({ prefs, setPrefs, reset, resolvedTheme, t, dict }), [prefs, setPrefs, reset, resolvedTheme, t, dict]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}

export const useT = () => usePreferences().t;
