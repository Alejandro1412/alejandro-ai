import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, cosineDistance, count, desc, eq, ilike, sql } from 'drizzle-orm';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { knowledgeChunks, knowledgeSources } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError, ValidationError } from '../common/errors/app-error';
import { likeTerm, offsetOf, Paginated, paginationSchema } from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { QueueService, TenantJob } from '../jobs/queue.service';
import { EventsService } from '../realtime/events.service';
import { UsageService } from '../usage/usage.service';
import { EmbeddingService } from '../ai/embeddings/embedding-provider';
import { norm } from '../ai/policy/text';
import { assertPublicUrl, chunkText, faqToChunks, htmlToText, normalizeText, tokenCount, type Chunk } from './text-processing';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME: Record<string, 'PDF' | 'TXT' | 'DOCX'> = {
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'text/markdown': 'TXT',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

export const textSourceSchema = z.object({
  title: z.string().trim().min(2).max(200),
  text: z.string().trim().min(10).max(200_000),
  category: z.string().trim().max(60).optional(),
});
export const faqSourceSchema = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.string().trim().max(60).optional(),
  items: z
    .array(z.object({ question: z.string().trim().min(3).max(500), answer: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(500),
});
export const urlSourceSchema = z.object({ url: z.string().url().max(2000), title: z.string().trim().max(200).optional(), category: z.string().trim().max(60).optional() });
export const websiteImportSchema = z.object({ url: z.string().url().max(2000), maxPages: z.number().int().min(1).max(15).default(8) });
export const updateSourceSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  isEnabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
});
export const listSourcesSchema = paginationSchema.extend({
  status: z.enum(['UPLOADING', 'PROCESSING', 'INDEXED', 'FAILED', 'DISABLED']).optional(),
  type: z.enum(['PDF', 'TXT', 'DOCX', 'FAQ', 'TEXT', 'URL']).optional(),
});

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  title: string;
  category: string | null;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

interface IngestJob extends TenantJob {
  sourceId: string;
}

/** Minimum hybrid score for a chunk to be considered relevant evidence. */
export const RELEVANCE_THRESHOLD = 0.22;

/**
 * Knowledge base / RAG pipeline:
 * Upload → Extract → Normalize → Chunk → Embed → Store (pgvector) → Retrieve → Rerank/filter.
 * Only static clinic knowledge lives here (policies, services, FAQs) — never availability.
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly embeddings: EmbeddingService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly billing: BillingService,
    private readonly usage: UsageService,
  ) {}

  onModuleInit(): void {
    this.queue.register<IngestJob>('knowledge-ingestion', (job) => this.process(job.sourceId), 2);
  }

  // ── Queries ──
  async list(q: z.infer<typeof listSourcesSchema>) {
    const where = tenantScope(
      knowledgeSources,
      eq(knowledgeSources.clinicId, TenantContext.clinicId()),
      q.status ? eq(knowledgeSources.status, q.status) : undefined,
      q.type ? eq(knowledgeSources.type, q.type) : undefined,
      q.search ? ilike(knowledgeSources.title, likeTerm(q.search)) : undefined,
    );
    const cols = {
      id: knowledgeSources.id,
      title: knowledgeSources.title,
      type: knowledgeSources.type,
      status: knowledgeSources.status,
      category: knowledgeSources.category,
      sourceUrl: knowledgeSources.sourceUrl,
      fileName: knowledgeSources.fileName,
      sizeBytes: knowledgeSources.sizeBytes,
      error: knowledgeSources.error,
      isEnabled: knowledgeSources.isEnabled,
      chunkCount: knowledgeSources.chunkCount,
      processedAt: knowledgeSources.processedAt,
      createdAt: knowledgeSources.createdAt,
      updatedAt: knowledgeSources.updatedAt,
    };
    const [items, [{ total }]] = await Promise.all([
      this.db.select(cols).from(knowledgeSources).where(where).orderBy(desc(knowledgeSources.createdAt)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ total: count() }).from(knowledgeSources).where(where),
    ]);
    return Paginated.of(items, total, q);
  }

  async get(id: string) {
    const [source] = await this.db.select().from(knowledgeSources).where(tenantScope(knowledgeSources, eq(knowledgeSources.id, id)));
    if (!source) throw new NotFoundError('KnowledgeSource', id);
    const chunks = await this.db
      .select({ id: knowledgeChunks.id, index: knowledgeChunks.index, content: knowledgeChunks.content, tokenCount: knowledgeChunks.tokenCount, metadata: knowledgeChunks.metadata })
      .from(knowledgeChunks)
      .where(tenantScope(knowledgeChunks, eq(knowledgeChunks.sourceId, id)))
      .orderBy(asc(knowledgeChunks.index))
      .limit(200);
    return { ...source, rawText: source.rawText?.slice(0, 20_000) ?? null, chunks };
  }

  async stats() {
    const rows = await this.db
      .select({ status: knowledgeSources.status, n: sql<number>`count(*)::int`, chunks: sql<number>`coalesce(sum(${knowledgeSources.chunkCount}),0)::int` })
      .from(knowledgeSources)
      .where(tenantScope(knowledgeSources, eq(knowledgeSources.clinicId, TenantContext.clinicId())))
      .groupBy(knowledgeSources.status);
    return {
      byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
      totalSources: rows.reduce((s, r) => s + r.n, 0),
      totalChunks: rows.reduce((s, r) => s + r.chunks, 0),
      embeddingModel: this.embeddings.provider.model,
    };
  }

  // ── Ingestion entry points ──
  async createFromFile(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, meta: { title?: string; category?: string }) {
    const type = ALLOWED_MIME[file.mimetype] ?? (file.originalname.toLowerCase().endsWith('.md') ? 'TXT' : undefined);
    if (!type) throw new ValidationError('Unsupported file type. Upload PDF, DOCX or TXT.');
    if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError('File exceeds the 10 MB limit');
    await this.billing.assertWithinLimit('knowledgeSources');
    const source = await this.insertSource({
      title: meta.title?.trim() || file.originalname.replace(/\.[^.]+$/, ''),
      type,
      category: meta.category,
      fileName: file.originalname.slice(0, 200),
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
    try {
      const text = await this.extract(type, file.buffer);
      await this.db.update(knowledgeSources).set({ rawText: text }).where(eq(knowledgeSources.id, source.id));
      await this.enqueue(source.id);
    } catch (err) {
      await this.fail(source.id, err);
    }
    return this.get(source.id);
  }

  async createFromText(dto: z.infer<typeof textSourceSchema>) {
    await this.billing.assertWithinLimit('knowledgeSources');
    const source = await this.insertSource({ title: dto.title, type: 'TEXT', category: dto.category, rawText: normalizeText(dto.text) });
    await this.enqueue(source.id);
    return source;
  }

  async createFaq(dto: z.infer<typeof faqSourceSchema>) {
    await this.billing.assertWithinLimit('knowledgeSources');
    const source = await this.insertSource({
      title: dto.title,
      type: 'FAQ',
      category: dto.category ?? 'faq',
      rawText: dto.items.map((i) => `P: ${i.question}\nR: ${i.answer}`).join('\n\n'),
      metadata: { faq: dto.items },
    });
    await this.enqueue(source.id);
    return source;
  }

  async createFromUrl(dto: z.infer<typeof urlSourceSchema>) {
    await assertPublicUrl(dto.url);
    await this.billing.assertWithinLimit('knowledgeSources');
    const source = await this.insertSource({ title: dto.title || dto.url, type: 'URL', category: dto.category, sourceUrl: dto.url });
    await this.enqueue(source.id);
    return source;
  }

  /**
   * Onboarding shortcut: reads the clinic website home page, picks the most useful same-site pages
   * (services, prices, hours, contact, team, FAQ…) and ingests each as a URL source.
   */
  async importWebsite(dto: z.infer<typeof websiteImportSchema>) {
    await assertPublicUrl(dto.url);
    const home = new URL(dto.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(home, { signal: controller.signal, redirect: 'error', headers: { 'User-Agent': 'AlejandroAI-KnowledgeBot/1.0' } }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new ValidationError(`The website returned HTTP ${res.status}`);
    const html = (await res.text()).slice(0, 2_000_000);
    const KEY = /(servicio|service|precio|tarifa|price|pricing|horario|hours|contact|ubicaci|location|sede|nosotros|about|equipo|team|doctor|medic|especialidad|specialt|faq|pregunta|question|seguro|insurance|pago|payment|preparaci|politica|policy)/i;
    const seen = new Set<string>([home.origin + home.pathname.replace(/\/$/, '')]);
    const candidates: { url: string; score: number }[] = [];
    for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let u: URL;
      try {
        u = new URL(m[1], home);
      } catch {
        continue;
      }
      if (u.host !== home.host || !/^https?:$/.test(u.protocol) || /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
      u.hash = '';
      u.search = '';
      const key = u.origin + u.pathname.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const label = m[2].replace(/<[^>]+>/g, ' ');
      candidates.push({ url: u.toString(), score: (KEY.test(u.pathname) ? 2 : 0) + (KEY.test(label) ? 1 : 0) });
    }
    const picked = [home.toString(), ...candidates.sort((a, b) => b.score - a.score).filter((c) => c.score > 0).slice(0, dto.maxPages - 1).map((c) => c.url)];
    const created: { id: string; url: string }[] = [];
    const skipped: { url: string; reason: string }[] = [];
    for (const url of picked) {
      try {
        const src = await this.createFromUrl({ url, category: 'website' });
        created.push({ id: src.id, url });
      } catch (err) {
        skipped.push({ url, reason: (err as { code?: string }).code ?? (err as Error).message });
        if ((err as { code?: string }).code === 'PLAN_LIMIT_REACHED') break;
      }
    }
    await this.audit.log({ action: 'knowledge.imported_url', entityType: 'KnowledgeSource', metadata: { site: home.origin, pages: created.length } });
    return { site: home.origin, created, skipped, discovered: candidates.length };
  }

  async update(id: string, dto: z.infer<typeof updateSourceSchema>) {
    const current = await this.get(id);
    const patch: Partial<typeof knowledgeSources.$inferInsert> = { ...dto };
    if (dto.isEnabled === false) patch.status = 'DISABLED';
    if (dto.isEnabled === true && current.status === 'DISABLED') patch.status = current.chunkCount > 0 ? 'INDEXED' : 'PROCESSING';
    const [row] = await this.db.update(knowledgeSources).set(patch).where(tenantScope(knowledgeSources, eq(knowledgeSources.id, id))).returning();
    if (dto.isEnabled === true && current.chunkCount === 0) await this.enqueue(id);
    await this.audit.log({ action: 'knowledge.updated', entityType: 'KnowledgeSource', entityId: id, metadata: { fields: Object.keys(dto) } });
    this.events.emit('knowledge.updated', { id });
    return row;
  }

  async remove(id: string) {
    const [row] = await this.db.delete(knowledgeSources).where(tenantScope(knowledgeSources, eq(knowledgeSources.id, id))).returning({ id: knowledgeSources.id });
    if (!row) throw new NotFoundError('KnowledgeSource', id);
    await this.audit.log({ action: 'knowledge.deleted', entityType: 'KnowledgeSource', entityId: id });
    this.events.emit('knowledge.updated', { id });
    return row;
  }

  async reprocess(id: string) {
    await this.get(id);
    await this.db.update(knowledgeSources).set({ status: 'PROCESSING', error: null }).where(tenantScope(knowledgeSources, eq(knowledgeSources.id, id)));
    await this.enqueue(id);
    return { id, status: 'PROCESSING' };
  }

  private async insertSource(values: Omit<typeof knowledgeSources.$inferInsert, 'organizationId' | 'clinicId'>) {
    const [row] = await this.db
      .insert(knowledgeSources)
      .values(withTenant({ ...values, clinicId: TenantContext.clinicId(), createdById: TenantContext.current()?.principal?.id ?? null, status: 'UPLOADING' as const }))
      .returning();
    await this.audit.log({ action: 'knowledge.uploaded', entityType: 'KnowledgeSource', entityId: row.id, metadata: { type: row.type, title: row.title } });
    return row;
  }

  private async enqueue(sourceId: string) {
    await this.queue.enqueue<IngestJob>('knowledge-ingestion', { organizationId: TenantContext.orgId(), clinicId: TenantContext.clinicId(), sourceId });
  }

  private async extract(type: 'PDF' | 'TXT' | 'DOCX', buffer: Buffer): Promise<string> {
    let raw: string;
    if (type === 'PDF') raw = (await pdfParse(buffer)).text;
    else if (type === 'DOCX') raw = (await mammoth.extractRawText({ buffer })).value;
    else raw = buffer.toString('utf8');
    const text = normalizeText(raw);
    if (text.length < 10) throw new ValidationError('No readable text found in the document');
    return text;
  }

  private async fail(sourceId: string, err: unknown) {
    this.logger.warn(`Knowledge source ${sourceId} failed: ${(err as Error).message}`);
    await this.db
      .update(knowledgeSources)
      .set({ status: 'FAILED', error: (err as Error).message.slice(0, 500) })
      .where(tenantScope(knowledgeSources, eq(knowledgeSources.id, sourceId)));
    this.events.emit('knowledge.updated', { id: sourceId, status: 'FAILED' });
  }

  /** Worker: (fetch) → chunk → embed → store. Idempotent: previous chunks are replaced. */
  async process(sourceId: string): Promise<void> {
    const [source] = await this.db.select().from(knowledgeSources).where(tenantScope(knowledgeSources, eq(knowledgeSources.id, sourceId)));
    if (!source) return;
    await this.db.update(knowledgeSources).set({ status: 'PROCESSING', error: null }).where(eq(knowledgeSources.id, sourceId));
    this.events.emit('knowledge.updated', { id: sourceId, status: 'PROCESSING' });
    try {
      let text = source.rawText ?? '';
      let title = source.title;
      if (source.type === 'URL' && source.sourceUrl) {
        const url = await assertPublicUrl(source.sourceUrl);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { 'User-Agent': 'AlejandroAI-KnowledgeBot/1.0' } }).finally(() => clearTimeout(timer));
        if (!res.ok) throw new Error(`URL returned HTTP ${res.status}`);
        const body = (await res.text()).slice(0, 2_000_000);
        const parsed = /html/i.test(res.headers.get('content-type') ?? '') ? htmlToText(body) : { title: null, text: normalizeText(body) };
        text = parsed.text;
        if (parsed.title && title === source.sourceUrl) title = parsed.title.slice(0, 200);
      }
      if (!text || text.length < 10) throw new Error('No readable text to index');

      const faq = (source.metadata as { faq?: { question: string; answer: string }[] }).faq;
      const chunks: Chunk[] = source.type === 'FAQ' && faq ? faqToChunks(faq) : chunkText(text);
      const vectors = await this.embeddings.provider.embed(chunks.map((c) => `${title}\n${c.heading ?? ''}\n${c.content}`));
      await this.db.transaction(async (tx) => {
        await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, sourceId));
        if (chunks.length)
          await tx.insert(knowledgeChunks).values(
            chunks.map((c, i) => ({
              organizationId: source.organizationId,
              clinicId: source.clinicId,
              sourceId,
              index: c.index,
              content: c.content,
              tokenCount: tokenCount(c.content),
              metadata: { heading: c.heading, title, category: source.category },
              embeddingModel: this.embeddings.provider.model,
              embedding: vectors[i],
            })),
          );
        await tx
          .update(knowledgeSources)
          .set({
            status: source.isEnabled ? 'INDEXED' : 'DISABLED',
            rawText: text,
            title,
            chunkCount: chunks.length,
            processedAt: new Date(),
            error: null,
          })
          .where(eq(knowledgeSources.id, sourceId));
      });
      if (this.embeddings.provider.name !== 'local') {
        await this.usage.record({ kind: 'EMBEDDING', provider: this.embeddings.provider.name, model: this.embeddings.provider.model, tokensIn: chunks.reduce((s, c) => s + tokenCount(c.content), 0) });
      }
      this.events.emit('knowledge.updated', { id: sourceId, status: 'INDEXED' });
    } catch (err) {
      await this.fail(sourceId, err);
    }
  }

  /**
   * Hybrid retrieval: pgvector cosine similarity (HNSW) for recall, then a lexical overlap
   * rerank and a relevance threshold so weak matches are not presented as evidence.
   */
  async search(query: string, opts: { topK?: number; category?: string } = {}): Promise<RetrievedChunk[]> {
    const topK = Math.min(opts.topK ?? 4, 10);
    const [vec] = await this.embeddings.provider.embed([query]);
    const distance = cosineDistance(knowledgeChunks.embedding, vec);
    const rows = await this.db
      .select({
        chunkId: knowledgeChunks.id,
        sourceId: knowledgeChunks.sourceId,
        content: knowledgeChunks.content,
        title: knowledgeSources.title,
        category: knowledgeSources.category,
        vectorScore: sql<number>`1 - (${distance})`,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
      .where(
        and(
          tenantScope(knowledgeChunks, eq(knowledgeChunks.clinicId, TenantContext.clinicId())),
          eq(knowledgeSources.isEnabled, true),
          eq(knowledgeSources.status, 'INDEXED'),
          opts.category ? eq(knowledgeSources.category, opts.category) : undefined,
        ),
      )
      .orderBy(distance)
      .limit(20);

    const qTerms = new Set(
      norm(query)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
    return rows
      .map((r) => {
        const cTerms = norm(r.content).split(/[^a-z0-9]+/);
        const hits = [...qTerms].filter((t) => cTerms.some((c) => c.startsWith(t.slice(0, Math.max(4, t.length - 2))))).length;
        const keywordScore = qTerms.size ? hits / qTerms.size : 0;
        const vectorScore = Number(r.vectorScore);
        return { ...r, vectorScore, keywordScore, score: 0.7 * vectorScore + 0.3 * keywordScore };
      })
      .filter((r) => r.score >= RELEVANCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
