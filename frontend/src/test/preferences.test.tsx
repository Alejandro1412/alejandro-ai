import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesContext';

const wrapper = ({ children }: { children: ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>;

describe('preferences (theme, language, accessibility)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('switches to dark mode and persists the choice', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper });
    act(() => result.current.setPrefs({ theme: 'dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('aai.prefs')!).theme).toBe('dark');
  });

  it('switches language, updates <html lang> and translates with interpolation', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper });
    act(() => result.current.setPrefs({ lang: 'en' }));
    expect(document.documentElement.lang).toBe('en');
    expect(result.current.t('common.confirm')).toBe('Confirm');
    act(() => result.current.setPrefs({ lang: 'es' }));
    expect(result.current.t('common.confirm')).toBe('Confirmar');
    expect(result.current.t('chat.moreSlots', { count: 4 })).toContain('4');
  });

  it('applies visual accessibility aids as root classes and font scale', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper });
    act(() => result.current.setPrefs({ highContrast: true, readableFont: true, underlineLinks: true, reduceMotion: true, fontScale: 1.25 }));
    const root = document.documentElement;
    expect(root).toHaveClass('hc', 'readable-font', 'underline-links', 'reduce-motion');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.25');
  });

  it('survives unavailable storage', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      const { result } = renderHook(() => usePreferences(), { wrapper });
      expect(result.current.prefs.fontScale).toBe(1);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
