import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { services as servicesTable } from '../../../database/schema';
import { TenantContext, tenantScope } from '../../../database/tenant';
import { norm } from '../../policy/text';
import { defineTool, ToolFailure } from '../tool';
import { formatPrice, ToolDeps } from '../tool-deps';

const DAY_NAMES: Record<string, { es: string; en: string }> = {
  mon: { es: 'Lunes', en: 'Monday' },
  tue: { es: 'Martes', en: 'Tuesday' },
  wed: { es: 'Miércoles', en: 'Wednesday' },
  thu: { es: 'Jueves', en: 'Thursday' },
  fri: { es: 'Viernes', en: 'Friday' },
  sat: { es: 'Sábado', en: 'Saturday' },
  sun: { es: 'Domingo', en: 'Sunday' },
};

/** Knowledge + clinic information tools (static / semi-static data). */
export function infoTools(d: ToolDeps) {
  const searchClinicKnowledge = defineTool({
    name: 'searchClinicKnowledge',
    description:
      'Search the clinic knowledge base (policies, services descriptions, FAQs, preparation instructions, insurance, payment methods). Use for general questions. NEVER use it for availability, appointments or patient data.',
    input: z.object({ query: z.string().min(2).max(300).describe('Natural-language search query'), topK: z.number().int().min(1).max(6).optional() }),
    output: z.object({
      found: z.boolean(),
      results: z.array(z.object({ sourceId: z.string(), title: z.string(), content: z.string(), score: z.number() })),
    }),
    permission: 'knowledge.read',
    async execute({ query, topK }) {
      const hits = await d.knowledge.search(query, { topK: topK ?? 3 });
      return {
        found: hits.length > 0,
        results: hits.map((h) => ({ sourceId: h.sourceId, title: h.title, content: h.content, score: Math.round(h.score * 1000) / 1000 })),
      };
    },
    present(out) {
      if (!out.found) return [];
      const seen = new Set<string>();
      return [
        {
          type: 'citations',
          sources: out.results
            .filter((r) => !seen.has(r.sourceId) && seen.add(r.sourceId))
            .map((r) => ({ sourceId: r.sourceId, title: r.title, excerpt: r.content.slice(0, 180), score: r.score })),
        },
      ];
    },
  });

  const getClinicInformation = defineTool({
    name: 'getClinicInformation',
    description: 'Get the clinic name, description, contact phone, email, website and address.',
    input: z.object({}),
    output: z.object({ name: z.string(), description: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), website: z.string().nullable(), address: z.string().nullable(), city: z.string().nullable() }),
    permission: null,
    async execute() {
      const c = await d.clinics.current();
      return { name: c.name, description: c.description, phone: c.phone, email: c.email, website: c.website, address: c.address, city: c.city };
    },
  });

  const getBusinessHours = defineTool({
    name: 'getBusinessHours',
    description: 'Get the clinic opening hours per weekday (clinic local time).',
    input: z.object({}),
    output: z.object({ timezone: z.string(), days: z.array(z.object({ day: z.string(), open: z.boolean(), intervals: z.array(z.string()) })) }),
    permission: null,
    async execute(_i, ctx) {
      const c = await d.clinics.current();
      return {
        timezone: c.timezone,
        days: Object.keys(DAY_NAMES).map((k) => {
          const intervals = (c.businessHours as Record<string, [string, string][]>)[k] ?? [];
          return { day: DAY_NAMES[k][ctx.language], open: intervals.length > 0, intervals: intervals.map(([a, b]) => `${a}–${b}`) };
        }),
      };
    },
  });

  const getClinicLocations = defineTool({
    name: 'getClinicLocations',
    description: 'List the clinic locations (sites) with address and phone.',
    input: z.object({}),
    output: z.object({ locations: z.array(z.object({ id: z.string(), name: z.string(), address: z.string(), city: z.string().nullable(), phone: z.string().nullable(), mapsUrl: z.string().nullable() })) }),
    permission: null,
    async execute() {
      const rows = await d.clinics.listLocations();
      return { locations: rows.map((l) => ({ id: l.id, name: l.name, address: l.address, city: l.city, phone: l.phone, mapsUrl: l.mapsUrl })) };
    },
  });

  const getServices = defineTool({
    name: 'getServices',
    description: 'List the services the clinic offers (name, specialty, duration and price when published). Optionally filter by specialty name.',
    input: z.object({ specialty: z.string().max(80).optional() }),
    output: z.object({
      services: z.array(z.object({ id: z.string(), name: z.string(), specialty: z.string().nullable(), durationMinutes: z.number(), price: z.string().nullable(), description: z.string().nullable() })),
    }),
    permission: 'services.read',
    async execute({ specialty }, ctx) {
      const rows = await d.clinics.listServices();
      const filtered = rows.filter((s) => s.isActive && (!specialty || norm(`${s.specialty?.name ?? ''} ${s.specialty?.nameEn ?? ''}`).includes(norm(specialty).slice(0, 6))));
      return {
        services: filtered.map((s) => ({
          id: s.id,
          name: ctx.language === 'en' && s.nameEn ? s.nameEn : s.name,
          specialty: s.specialty?.name ?? null,
          durationMinutes: s.durationMinutes,
          price: formatPrice(s.priceCents, s.currency, ctx.language),
          description: s.description,
        })),
      };
    },
    present(out) {
      return out.services.length
        ? [{ type: 'services', items: out.services.slice(0, 12).map((s) => ({ id: s.id, name: s.name, specialty: s.specialty, durationMinutes: s.durationMinutes, price: s.price })) }]
        : [];
    },
  });

  const getServiceInformation = defineTool({
    name: 'getServiceInformation',
    description: 'Get details of one service (duration, price if published, specialty). Price null means it is not published — never invent it.',
    input: z.object({ serviceId: z.string().uuid().optional(), name: z.string().max(120).optional() }),
    output: z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), specialty: z.string().nullable(), durationMinutes: z.number(), price: z.string().nullable(), priceCents: z.number().nullable() }),
    permission: 'services.read',
    async execute({ serviceId, name }, ctx) {
      const rows = await d.clinics.listServices();
      const q = name ? norm(name) : '';
      const s =
        rows.find((r) => r.id === serviceId) ??
        rows.find((r) => q && (norm(r.name).includes(q) || q.includes(norm(r.name)) || norm(r.nameEn ?? '').includes(q))) ??
        rows.find((r) => q && q.split(' ').some((w) => w.length > 5 && norm(`${r.name} ${r.nameEn ?? ''}`).includes(w)));
      if (!s) throw new ToolFailure('SERVICE_NOT_FOUND', 'No service matches that name', 'Call getServices to list available services');
      return {
        id: s.id,
        name: ctx.language === 'en' && s.nameEn ? s.nameEn : s.name,
        description: s.description,
        specialty: s.specialty?.name ?? null,
        durationMinutes: s.durationMinutes,
        price: formatPrice(s.priceCents, s.currency, ctx.language),
        priceCents: s.priceCents,
      };
    },
  });

  return [searchClinicKnowledge, getClinicInformation, getBusinessHours, getClinicLocations, getServices, getServiceInformation];
}

/** Used by tools that need the service duration without loading everything. */
export async function serviceExists(d: ToolDeps, id: string) {
  const [row] = await d.db.select({ id: servicesTable.id }).from(servicesTable).where(and(tenantScope(servicesTable, eq(servicesTable.id, id)), eq(servicesTable.clinicId, TenantContext.clinicId())));
  return Boolean(row);
}
