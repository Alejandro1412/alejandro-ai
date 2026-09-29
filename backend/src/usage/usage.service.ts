import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { usageRecords } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';

export interface UsageInput {
  kind: 'AI_COMPLETION' | 'AI_CONVERSATION' | 'EMBEDDING' | 'WHATSAPP_MESSAGE' | 'SMS_MESSAGE';
  provider?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  costMicroUsd?: number;
  conversationId?: string | null;
  quantity?: number;
}

/** Usage metering: every AI call, embedding and outbound message is recorded for cost control and usage billing. */
@Injectable()
export class UsageService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(input: UsageInput): Promise<void> {
    await this.db.insert(usageRecords).values(
      withTenant({
        clinicId: TenantContext.current()?.clinicId ?? null,
        conversationId: input.conversationId ?? null,
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        latencyMs: input.latencyMs,
        costMicroUsd: Math.round(input.costMicroUsd ?? 0),
        quantity: input.quantity ?? 1,
      }),
    );
  }

  async countSince(kind: UsageInput['kind'], since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)::int` })
      .from(usageRecords)
      .where(tenantScope(usageRecords, eq(usageRecords.kind, kind), gte(usageRecords.createdAt, since)));
    return row.n;
  }

  async summary(since: Date) {
    const rows = await this.db
      .select({
        kind: usageRecords.kind,
        provider: usageRecords.provider,
        model: usageRecords.model,
        calls: sql<number>`count(*)::int`,
        quantity: sql<number>`coalesce(sum(${usageRecords.quantity}),0)::int`,
        tokensIn: sql<number>`coalesce(sum(${usageRecords.tokensIn}),0)::int`,
        tokensOut: sql<number>`coalesce(sum(${usageRecords.tokensOut}),0)::int`,
        costMicroUsd: sql<number>`coalesce(sum(${usageRecords.costMicroUsd}),0)::bigint`,
        avgLatencyMs: sql<number>`coalesce(avg(${usageRecords.latencyMs}),0)::int`,
      })
      .from(usageRecords)
      .where(and(tenantScope(usageRecords), gte(usageRecords.createdAt, since)))
      .groupBy(usageRecords.kind, usageRecords.provider, usageRecords.model);
    return rows.map((r) => ({ ...r, costMicroUsd: Number(r.costMicroUsd), costUsd: Number(r.costMicroUsd) / 1e6 }));
  }
}
