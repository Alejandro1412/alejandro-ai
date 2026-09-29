import type { PlanLimits } from '../database/schema';

/**
 * Commercial catalog. Seeded into the `plans` table — business code reads limits from the
 * database through EntitlementsService, never from these constants directly.
 * Prices in USD cents. Yearly = 2 months free (~17% off).
 */
export interface PlanDefinition {
  key: 'STARTER' | 'PROFESSIONAL' | 'CLINIC';
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  limits: PlanLimits;
  features: string[];
  isPopular: boolean;
  sortOrder: number;
}

export const PLAN_CATALOG: PlanDefinition[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    description: 'For independent professionals and small practices getting started with AI.',
    priceMonthlyCents: 4900,
    priceYearlyCents: 49000,
    limits: {
      doctors: 3,
      users: 3,
      aiConversationsPerMonth: 500,
      knowledgeSources: 20,
      whatsapp: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
    },
    features: [
      'ai_receptionist_webchat',
      'appointment_booking',
      'knowledge_base',
      'patient_portal',
      'basic_analytics',
      'email_notifications',
    ],
    isPopular: false,
    sortOrder: 1,
  },
  {
    key: 'PROFESSIONAL',
    name: 'Professional',
    description: 'For growing clinics that want 24/7 automation across channels.',
    priceMonthlyCents: 14900,
    priceYearlyCents: 149000,
    limits: {
      doctors: 15,
      users: 15,
      aiConversationsPerMonth: 3000,
      knowledgeSources: 200,
      whatsapp: true,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
    },
    features: [
      'everything_in_starter',
      'whatsapp_channel',
      'calendar_sync',
      'human_handoff_queue',
      'advanced_analytics',
      'reminders_whatsapp_sms',
      'audit_log',
    ],
    isPopular: true,
    sortOrder: 2,
  },
  {
    key: 'CLINIC',
    name: 'Clinic',
    description: 'For multi-doctor clinics and medical centers with advanced needs.',
    priceMonthlyCents: 39900,
    priceYearlyCents: 399000,
    limits: {
      doctors: null,
      users: null,
      aiConversationsPerMonth: 15000,
      knowledgeSources: null,
      whatsapp: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
    },
    features: [
      'everything_in_professional',
      'unlimited_doctors',
      'multi_location',
      'custom_branding',
      'api_access',
      'priority_support',
      'dedicated_onboarding',
    ],
    isPopular: false,
    sortOrder: 3,
  },
];

/** Overage price per AI conversation beyond the plan allowance (micro-USD). */
export const AI_CONVERSATION_OVERAGE_MICRO_USD = 40_000; // $0.04
export const TRIAL_DAYS = 14;
