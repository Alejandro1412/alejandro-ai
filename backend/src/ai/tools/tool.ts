import { z, ZodType } from 'zod';
import type { PermissionKey } from '../../rbac/permissions';
import type { AgentConfig } from '../agent-config';
import type { Attachment } from '../attachments';

export interface ToolContext {
  conversationId: string;
  clinicId: string;
  patientId: string | null;
  language: 'es' | 'en';
  timezone: string;
  channel: string;
  agent: AgentConfig;
  /** Binds an identified/created patient to the conversation (short-term → operational state). */
  bindPatient(patientId: string): Promise<void>;
}

/** A failure the model can recover from (returned as a tool result, never thrown to the user). */
export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  /** RBAC permission the AI_AGENT role must hold. null = public clinic information. */
  permission: PermissionKey | null;
  /** Operations with side effects are audited as AI actions and can be disabled per clinic. */
  sideEffect: boolean;
  requiresPatient: boolean;
  execute(input: I, ctx: ToolContext): Promise<O>;
  present?(output: O, ctx: ToolContext, input: I): Attachment[];
}

export function defineTool<I extends ZodType, O extends ZodType>(def: {
  name: string;
  description: string;
  input: I;
  output: O;
  permission: PermissionKey | null;
  sideEffect?: boolean;
  requiresPatient?: boolean;
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
  present?: (output: z.infer<O>, ctx: ToolContext, input: z.infer<I>) => Attachment[];
}): AgentTool<z.infer<I>, z.infer<O>> {
  return { sideEffect: false, requiresPatient: false, ...def } as AgentTool<z.infer<I>, z.infer<O>>;
}

/** JSON Schema for the LLM function declaration. */
export function toolParameters(tool: AgentTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
