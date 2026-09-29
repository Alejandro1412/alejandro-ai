import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { Database, DB } from '../../database/database.module';
import { doctors, messages, patients, PatientPreferences } from '../../database/schema';
import { tenantScope } from '../../database/tenant';
import { doctorDisplayName, personName } from '../../common/utils/time';
import type { ChatMessage } from '../llm/llm-provider';

/**
 * Layered agent memory:
 *  - short-term: the recent turns of THIS conversation (token-budgeted),
 *  - long-term: allow-listed administrative preferences on the patient record,
 *  - knowledge: RAG (KnowledgeService),
 *  - operational state: the database, accessed only through tools.
 * Full transcripts are never promoted to permanent memory.
 */
@Injectable()
export class MemoryService {
  static readonly SHORT_TERM_MESSAGES = 16;
  static readonly SHORT_TERM_CHAR_BUDGET = 8000;

  constructor(@Inject(DB) private readonly db: Database) {}

  async shortTerm(conversationId: string, excludeMessageId?: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select({ id: messages.id, role: messages.role, content: messages.content })
      .from(messages)
      .where(tenantScope(messages, eq(messages.conversationId, conversationId)))
      .orderBy(desc(messages.createdAt))
      .limit(MemoryService.SHORT_TERM_MESSAGES);
    const out: ChatMessage[] = [];
    let budget = MemoryService.SHORT_TERM_CHAR_BUDGET;
    for (const r of rows) {
      if (r.id === excludeMessageId || r.role === 'SYSTEM' || r.role === 'TOOL') continue;
      const content = r.role === 'STAFF' ? `[Clinic staff]: ${r.content}` : r.content;
      budget -= content.length;
      if (budget < 0) break;
      out.push(r.role === 'USER' ? { role: 'user', content } : { role: 'assistant', content });
    }
    // Conversations must start with a user turn for some providers.
    const ordered = out.reverse();
    while (ordered.length && ordered[0].role !== 'user') ordered.shift();
    return ordered;
  }

  async longTerm(patientId: string | null): Promise<{ name: string; facts: string[] } | null> {
    if (!patientId) return null;
    const [p] = await this.db.select().from(patients).where(tenantScope(patients, eq(patients.id, patientId)));
    if (!p) return null;
    const prefs = p.preferences as PatientPreferences;
    const facts = [`preferred language: ${p.preferredLanguage}`];
    if (prefs.preferredContactChannel) facts.push(`preferred contact channel: ${prefs.preferredContactChannel}`);
    if (prefs.preferredTimeOfDay) facts.push(`prefers ${prefs.preferredTimeOfDay.toLowerCase()} appointments`);
    if (prefs.preferredDoctorId) {
      const [d] = await this.db.select().from(doctors).where(tenantScope(doctors, eq(doctors.id, prefs.preferredDoctorId)));
      if (d) facts.push(`last booked with ${doctorDisplayName(d)} (id ${d.id})`);
    }
    return { name: personName(p), facts };
  }
}
