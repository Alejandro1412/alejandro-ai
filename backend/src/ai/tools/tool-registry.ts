import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, DB } from '../../database/database.module';
import { agentTools, toolExecutions } from '../../database/schema';
import { TenantContext, withTenant } from '../../database/tenant';
import { withTimeout } from '../../common/utils/resilience';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../audit/audit.service';
import { EventsService } from '../../realtime/events.service';
import { RbacService } from '../../rbac/rbac.service';
import type { AgentConfig } from '../agent-config';
import type { Attachment } from '../attachments';
import type { ToolCall, ToolSpec } from '../llm/llm-provider';
import { AgentTool, ToolContext, ToolFailure, toolParameters } from './tool';

export const TOOLS = Symbol('AGENT_TOOLS');

export interface ToolResult {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: 'SUCCESS' | 'ERROR' | 'DENIED';
  ok: boolean;
  output: unknown;
  error: { code: string; message: string; hint?: string } | null;
  attachments: Attachment[];
  latencyMs: number;
}

const TOOL_TIMEOUT_MS = 10_000;

/**
 * Tool registry + executor. The ONLY way the agent touches the system:
 * lookup → clinic allow-list → RBAC (AI_AGENT) → patient requirement → input validation →
 * execution (timeout) → output validation → persistence + audit + realtime trace.
 * The model never gets SQL, filesystem or arbitrary code execution.
 */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly byName: Map<string, AgentTool>;

  constructor(
    @Inject(TOOLS) tools: AgentTool[],
    @Inject(DB) private readonly db: Database,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {
    this.byName = new Map(tools.map((t) => [t.name, t]));
  }

  all(): AgentTool[] {
    return [...this.byName.values()];
  }

  get(name: string): AgentTool | undefined {
    return this.byName.get(name);
  }

  async disabledFor(agent: AgentConfig): Promise<Set<string>> {
    const rows = await this.db.select().from(agentTools).where(eq(agentTools.agentId, agent.id));
    return new Set(rows.filter((r) => !r.enabled).map((r) => r.toolName));
  }

  async isAllowed(agent: AgentConfig, name: string, disabled?: Set<string>): Promise<boolean> {
    const off = disabled ?? (await this.disabledFor(agent));
    if (off.has(name)) return false;
    return !agent.allowedActions.length || agent.allowedActions.includes(name);
  }

  async specsFor(agent: AgentConfig): Promise<ToolSpec[]> {
    const disabled = await this.disabledFor(agent);
    const out: ToolSpec[] = [];
    for (const t of this.all()) if (await this.isAllowed(agent, t.name, disabled)) out.push({ name: t.name, description: t.description, parameters: toolParameters(t) });
    return out;
  }

  async catalog(agent: AgentConfig) {
    const disabled = await this.disabledFor(agent);
    const perms = await this.rbac.permissionsFor('AI_AGENT');
    return Promise.all(
      this.all().map(async (t) => ({
        name: t.name,
        description: t.description,
        permission: t.permission,
        sideEffect: t.sideEffect,
        requiresPatient: t.requiresPatient,
        enabled: await this.isAllowed(agent, t.name, disabled),
        permitted: !t.permission || perms.has(t.permission),
        parameters: toolParameters(t),
      })),
    );
  }

  async setEnabled(agent: AgentConfig, toolName: string, enabled: boolean) {
    await this.db
      .insert(agentTools)
      .values({ agentId: agent.id, toolName, enabled })
      .onConflictDoUpdate({ target: [agentTools.agentId, agentTools.toolName], set: { enabled } });
  }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const base = { callId: call.id, name: call.name, args: call.arguments ?? {} };
    const finish = async (r: Omit<ToolResult, 'callId' | 'name' | 'args' | 'latencyMs'>): Promise<ToolResult> => {
      const result: ToolResult = { ...base, ...r, latencyMs: Date.now() - started };
      await this.record(result, ctx);
      return result;
    };
    const deny = (code: string, message: string, hint?: string) =>
      finish({ status: 'DENIED', ok: false, output: null, error: { code, message, hint }, attachments: [] });

    const tool = this.byName.get(call.name);
    if (!tool) return deny('UNKNOWN_TOOL', `Tool ${call.name} does not exist`);
    if (!(await this.isAllowed(ctx.agent, tool.name))) return deny('TOOL_DISABLED', `The clinic has disabled ${tool.name}`, 'Offer a human handoff instead');
    if (tool.permission && !TenantContext.principal().permissions.has(tool.permission)) return deny('PERMISSION_DENIED', `AI agent lacks ${tool.permission}`);
    if (tool.requiresPatient && !ctx.patientId) {
      return deny('PATIENT_NOT_IDENTIFIED', 'The patient is not identified yet', 'Ask for full name and phone number, then call createPatient');
    }
    const parsed = tool.input.safeParse(call.arguments ?? {});
    if (!parsed.success) {
      return finish({
        status: 'ERROR',
        ok: false,
        output: null,
        error: { code: 'INVALID_ARGUMENTS', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        attachments: [],
      });
    }
    try {
      const raw = await withTimeout(tool.execute(parsed.data, ctx), TOOL_TIMEOUT_MS, `tool ${tool.name}`);
      const out = tool.output.safeParse(raw);
      if (!out.success) {
        this.logger.error(`Tool ${tool.name} returned invalid output: ${out.error.message}`);
        return finish({ status: 'ERROR', ok: false, output: null, error: { code: 'INVALID_TOOL_OUTPUT', message: 'Tool produced an invalid result' }, attachments: [] });
      }
      const attachments = tool.present ? tool.present(out.data, ctx, parsed.data) : [];
      return finish({ status: 'SUCCESS', ok: true, output: out.data, error: null, attachments });
    } catch (err) {
      const e =
        err instanceof ToolFailure
          ? { code: err.code, message: err.message, hint: err.hint }
          : err instanceof AppError
            ? { code: err.code, message: err.message }
            : { code: 'TOOL_ERROR', message: 'The operation failed unexpectedly' };
      if (!(err instanceof ToolFailure) && !(err instanceof AppError)) this.logger.error(`Tool ${tool.name} crashed: ${(err as Error).stack}`);
      return finish({ status: 'ERROR', ok: false, output: null, error: e, attachments: [] });
    }
  }

  private async record(r: ToolResult, ctx: ToolContext) {
    const tool = this.byName.get(r.name);
    await this.db.insert(toolExecutions).values(
      withTenant({
        conversationId: ctx.conversationId,
        toolName: r.name,
        input: r.args,
        output: r.ok ? truncate(r.output) : r.error,
        status: r.status,
        errorCode: r.error?.code ?? null,
        latencyMs: r.latencyMs,
      }),
    );
    if (r.status === 'DENIED' || tool?.sideEffect) {
      await this.audit.log({
        action: r.status === 'DENIED' ? 'ai.tool_denied' : 'ai.tool_executed',
        entityType: 'Tool',
        entityId: r.name,
        patientId: ctx.patientId,
        result: r.status === 'SUCCESS' ? 'SUCCESS' : r.status === 'DENIED' ? 'DENIED' : 'FAILURE',
        metadata: { tool: r.name, args: r.args, conversationId: ctx.conversationId, error: r.error?.code },
      });
    }
    this.events.emit('agent.step', { conversationId: ctx.conversationId, type: 'tool', name: r.name, status: r.status, latencyMs: r.latencyMs });
  }
}

function truncate(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length > 8000 ? { truncated: true, preview: s.slice(0, 8000) } : v;
}
