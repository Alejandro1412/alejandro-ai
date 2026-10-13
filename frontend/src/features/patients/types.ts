import type { Patient } from '@/types';

/** v3 privacy fields on patient objects. */
export type PatientV3 = Patient & {
  consentAt?: string | null;
  consentVersion?: string | null;
  marketingConsentAt?: string | null;
  anonymizedAt?: string | null;
};

export interface ConsentRecord {
  kind: 'DATA_PROCESSING' | 'MARKETING';
  granted: boolean;
  version: string | null;
  channel: string | null;
  createdAt: string;
}
