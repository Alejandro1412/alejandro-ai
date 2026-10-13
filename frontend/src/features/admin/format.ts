import type { Lang } from '@/contexts/PreferencesContext';

/** USD amounts given in dollars (AI cost). Small values keep cents so $0.04 never shows as $0. */
export const fmtUsd = (usd: number, lang: Lang) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);
