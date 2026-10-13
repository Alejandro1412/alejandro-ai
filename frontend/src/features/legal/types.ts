import type { Lang } from '@/contexts/PreferencesContext';

/** A paragraph (string) or a bullet list (string[]). Content is plain text: never rendered as HTML. */
export type LegalBlock = string | string[];

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocContent {
  title: string;
  intro: string;
  sections: LegalSection[];
}

export type LegalDocKey = 'terms' | 'privacy' | 'dpa';
export type LegalDocSet = Record<Lang, LegalDocContent>;

export const LEGAL_DOCS: LegalDocKey[] = ['terms', 'privacy', 'dpa'];
export const LEGAL_LAST_UPDATED = '2026-10';

export const isLegalDoc = (v: string | undefined): v is LegalDocKey => v === 'terms' || v === 'privacy' || v === 'dpa';
