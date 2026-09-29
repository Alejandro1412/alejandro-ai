import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { PreferencesProvider, type Lang, type Preferences } from '@/contexts/PreferencesContext';

/** Renders with the preferences provider in a fixed language (stored the same way the app stores it). */
export function renderWithPrefs(ui: ReactElement, { lang = 'es', prefs = {}, ...options }: RenderOptions & { lang?: Lang; prefs?: Partial<Preferences> } = {}) {
  localStorage.setItem('aai.prefs', JSON.stringify({ ...prefs, lang }));
  const Wrapper = ({ children }: { children: ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>;
  return render(ui, { wrapper: Wrapper, ...options });
}
