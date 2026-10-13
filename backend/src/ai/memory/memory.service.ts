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
      .select({ id: messages.id, role: messages.role, content: messages.content, attachments: messages.attachments })
      .from(messages)
      .where(tenantScope(messages, eq(messages.conversationId, conversationId)))
      .orderBy(desc(messages.createdAt))
      .limit(MemoryService.SHORT_TERM_MESSAGES);
    const out: ChatMessage[] = [];
    let budget = MemoryService.SHORT_TERM_CHAR_BUDGET;
    for (const r of rows) {
      if (r.id === excludeMessageId || r.role === 'SYSTEM' || r.role === 'TOOL') continue;
      const note = r.role === 'ASSISTANT' ? shownNote(r.attachments as unknown[]) : '';
      const content = r.role === 'STAFF' ? `[Clinic staff]: ${r.content}` : note ? `${r.content}\n${note}` : r.content;
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

/**
 * Compact, id-bearing summary of the cards an assistant message displayed, so a real LLM can resolve
 * references like "the second one" or "Friday at 8" in later turns.
 */
export function shownNote(attachments: unknown[] | null | undefined): string {
  const parts: string[] = [];
  for (const a of (attachments ?? []) as Record<string, unknown>[]) {
    if (a.type === 'slots') {
      const groups = a.groups as { doctorId: string; doctorName: string; slots: { start: string }[] }[];
      const list = groups.flatMap((g) => g.slots.slice(0, 8).map((x) => `${g.doctorName} (doctorId ${g.doctorId}) ${x.start}`));
      parts.push(`slots for ${a.mode}${a.appointmentId ? ` of appointment ${a.appointmentId}` : ''}: ${list.join('; ')}`);
    } else if (a.type === 'appointments') {
      const items = a.items as { id: string; doctorName: string; start: string }[];
      parts.push(`appointments (${a.purpose}): ${items.map((i) => `${i.id} ${i.doctorName} ${i.start}`).join('; ')}`);
    } else if (a.type === 'appointment') {
      const ap = a.appointment as { id: string; doctorName: string; start: string };
      parts.push(`appointment ${a.state}: ${ap.id} ${ap.doctorName} ${ap.start}`);
    } else if (a.type === 'confirm') {
      parts.push(`awaiting confirmation of ${JSON.stringify(a.action)}`);
    }
  }
  return parts.length ? `[shown: ${parts.join(' | ').slice(0, 1200)}]` : '';
}
