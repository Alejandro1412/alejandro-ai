export const SUB_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'SUSPENDED', 'CANCELED'] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];
export const PLAN_KEYS = ['STARTER', 'PROFESSIONAL', 'CLINIC'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface AiBudget {
  capUsd: number | null;
  spentUsd: number;
  exceeded: boolean;
}

export interface AdminOverview {
  tenants: number;
  byStatus: Record<SubStatus, number>;
  byPlan: Record<PlanKey, number>;
  mrrCents: number;
  arrCents: number;
  signupsLast30Days: number;
  thisMonth: { aiCostUsd: number; aiConversations: number; outboundMessages: number };
  openInvoicesCents: number;
}

export interface AdminTenant {
  id: string;
  name: string;
  createdAt: string;
  clinic: { id: string; name: string; slug: string; city: string | null; onboardedAt: string | null } | null;
  plan: { key: PlanKey; name: string } | null;
  subscription: {
    status: SubStatus;
    interval: 'MONTHLY' | 'YEARLY';
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    suspendedReason: string | null;
  } | null;
  users: number;
  doctors: number;
  conversationsThisMonth: number;
  aiCostUsd: number;
  lastActivity: string | null;
}

export interface AdminTenantDetail extends AdminTenant {
  invoices: { id: string; number: string; amountCents: number; currency: string; status: string; issuedAt: string; description?: string | null; hostedUrl?: string | null }[];
  usage: { kind: string; quantity: number; costUsd: number }[];
  team: { id: string; name: string; email: string; lastLoginAt: string | null; role: string }[];
  aiBudget: AiBudget;
}
