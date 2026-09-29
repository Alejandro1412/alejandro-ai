import { z } from 'zod';
import type { agents } from '../database/schema';

export type AgentConfig = typeof agents.$inferSelect;

export const agentConfigSchema = z.object({
  name: z.string().trim().min(2).max(60),
  welcomeMessage: z.string().trim().min(2).max(500),
  welcomeMessageEn: z.string().trim().min(2).max(500),
  tone: z.enum(['friendly_professional', 'formal', 'warm', 'concise']),
  languages: z.array(z.enum(['es', 'en'])).min(1),
  provider: z.enum(['mock', 'openai', 'anthropic', 'gemini']),
  model: z.string().trim().min(2).max(80),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().min(100).max(4000),
  handoffRules: z.object({
    onUserRequest: z.boolean(),
    onLowConfidence: z.boolean(),
    onSensitiveTopic: z.boolean(),
    maxFailedTurns: z.number().int().min(1).max(10),
    keywords: z.array(z.string().trim().min(2).max(40)).max(50),
  }),
  allowedActions: z.array(z.string().max(60)).max(50),
  bookingRules: z.object({
    minNoticeHours: z.number().int().min(0).max(168),
    maxDaysAhead: z.number().int().min(1).max(365),
    slotStepMinutes: z.number().int().min(5).max(120),
    requireConfirmation: z.boolean(),
    maxSlotsToOffer: z.number().int().min(1).max(12),
  }),
  cancellationPolicy: z.string().trim().max(1000).nullable(),
  notificationRules: z.object({
    onBooking: z.array(z.enum(['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS'])),
    onCancel: z.array(z.enum(['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS'])),
    reminderHoursBefore: z.number().int().min(1).max(168),
  }),
  systemPromptExtra: z.string().trim().max(2000).nullable(),
  isActive: z.boolean(),
});

export const updateAgentConfigSchema = agentConfigSchema.partial();
