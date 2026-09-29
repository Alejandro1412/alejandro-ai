/**
 * Realistic demo data: NovaCare Medical Center (+ a second tenant, Clínica Aurora, to demonstrate isolation).
 * Usage: npm run db:seed   (refuses to run in production unless SEED_FORCE=true)
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DateTime } from 'luxon';
import { Pool } from 'pg';
import * as s from '../schema';
import { PERMISSIONS, ROLE_DEFINITIONS } from '../../rbac/permissions';
import { PLAN_CATALOG } from '../../billing/plan-catalog';
import { DEFAULT_BOOKING_RULES, DEFAULT_CANCELLATION_POLICY, DEFAULT_HANDOFF_RULES, DEFAULT_NOTIFICATION_RULES } from '../../ai/agent-defaults';
import { LocalEmbeddingProvider } from '../../ai/embeddings/embedding-provider';
import { chunkText, faqToChunks, normalizeText, tokenCount } from '../../knowledge/text-processing';
import { KNOWLEDGE_FAQ, KNOWLEDGE_TEXTS } from './knowledge-content';

const TZ = 'America/Bogota';
export const DEMO_PASSWORD = 'NovaCare2026!';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260929);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

const FIRST = ['María', 'Ana', 'Laura', 'Camila', 'Valentina', 'Daniela', 'Sofía', 'Juliana', 'Paula', 'Natalia', 'Carolina', 'Andrea', 'Luis', 'Carlos', 'Andrés', 'Felipe', 'Santiago', 'Mateo', 'Sebastián', 'Diego', 'Javier', 'Ricardo', 'Jorge', 'Miguel', 'Alejandro', 'Esteban', 'Nicolás', 'Tomás', 'Gabriela', 'Isabella'];
const LAST = ['Rodríguez', 'Gómez', 'González', 'Martínez', 'López', 'Hernández', 'Ramírez', 'Torres', 'Díaz', 'Moreno', 'Vargas', 'Castro', 'Rojas', 'Jiménez', 'Ortiz', 'Suárez', 'Restrepo', 'Ospina', 'Cárdenas', 'Mejía', 'Salazar', 'Quintero', 'Arango', 'Zapata', 'Londoño'];

export async function runSeed(databaseUrl = process.env.DATABASE_URL, opts: { quiet?: boolean; ifEmpty?: boolean } = {}) {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') throw new Error('Refusing to seed in production (set SEED_FORCE=true to override)');
  const log = opts.quiet ? () => undefined : (m: string) => console.warn(m);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const db = drizzle(pool, { schema: s });
  if (opts.ifEmpty) {
    // Used by the Docker demo entrypoint: never wipe a database that already has tenants.
    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from organizations');
    if (rows[0].n > 0) {
      log('• Database already has data — skipping demo seed');
      await pool.end();
      return;
    }
  }
  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const now = DateTime.now().setZone(TZ);

  log('→ Resetting data');
  const tables = [
    'usage_records', 'invoices', 'subscriptions', 'plans', 'webhook_events', 'audit_logs', 'notifications', 'support_tickets', 'handoffs', 'leads',
    'knowledge_chunks', 'knowledge_sources', 'tool_executions', 'agent_tools', 'agents', 'messages', 'conversations', 'calendar_integrations',
    'appointments', 'patients', 'time_off', 'doctor_schedules', 'doctor_services', 'doctors', 'services', 'specialties', 'refresh_tokens',
    'memberships', 'role_permissions', 'permissions', 'roles', 'locations', 'clinics', 'organizations', 'users',
  ];
  await db.execute(sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`));

  // ── RBAC + plans ──
  const perms = await db.insert(s.permissions).values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description }))).returning();
  const permId = new Map(perms.map((p) => [p.key, p.id]));
  const roleId = new Map<string, string>();
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    const [r] = await db.insert(s.roles).values({ key, name: def.name, description: def.description }).returning();
    roleId.set(key, r.id);
    await db.insert(s.rolePermissions).values(def.permissions.map((p) => ({ roleId: r.id, permissionId: permId.get(p)! })));
  }
  const planRows = await db
    .insert(s.plans)
    .values(PLAN_CATALOG.map((p) => ({ key: p.key, name: p.name, description: p.description, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, limits: p.limits, features: p.features, isPopular: p.isPopular, sortOrder: p.sortOrder })))
    .returning();
  const plan = (k: string) => planRows.find((p) => p.key === k)!;

  // ── Tenant 1: NovaCare ──
  log('→ NovaCare Medical Center');
  const [org] = await db.insert(s.organizations).values({ name: 'NovaCare Health Group', slug: 'novacare-health' }).returning();
  const [clinic] = await db
    .insert(s.clinics)
    .values({
      organizationId: org.id,
      name: 'NovaCare Medical Center',
      slug: 'novacare',
      description: 'Centro médico especializado en Cardiología, Dermatología y Ortopedia en Bogotá.',
      timezone: TZ,
      locale: 'es',
      currency: 'COP',
      phone: '+57 601 745 2200',
      email: 'citas@novacare.co',
      website: 'https://novacare.co',
      address: 'Calle 93 #11-26, Chicó',
      city: 'Bogotá',
      country: 'Colombia',
      businessHours: { mon: [['07:00', '19:00']], tue: [['07:00', '19:00']], wed: [['07:00', '19:00']], thu: [['07:00', '19:00']], fri: [['07:00', '19:00']], sat: [['08:00', '12:00']] },
      onboardedAt: now.minus({ days: 90 }).toJSDate(),
    })
    .returning();
  const O = { organizationId: org.id };
  const C = { ...O, clinicId: clinic.id };
  const [chico, usaquen] = await db
    .insert(s.locations)
    .values([
      { ...C, name: 'Sede Chicó', address: 'Calle 93 #11-26, Consultorio 402', city: 'Bogotá', phone: '+57 601 745 2200', mapsUrl: 'https://maps.google.com/?q=Calle+93+11-26+Bogota' },
      { ...C, name: 'Sede Usaquén', address: 'Carrera 7 #120-20, Piso 3', city: 'Bogotá', phone: '+57 601 745 2210', mapsUrl: 'https://maps.google.com/?q=Carrera+7+120-20+Bogota' },
    ])
    .returning();

  const mkUser = async (email: string, name: string, role: string, extra: Partial<typeof s.users.$inferInsert> = {}) => {
    const [u] = await db.insert(s.users).values({ email, name, passwordHash: hash, lastLoginAt: now.minus({ hours: Math.floor(rand() * 48) }).toJSDate(), ...extra }).returning();
    await db.insert(s.memberships).values({ userId: u.id, organizationId: org.id, clinicId: clinic.id, roleId: roleId.get(role)! });
    return u;
  };
  const admin = await mkUser('admin@novacare.co', 'Laura Méndez', 'CLINIC_ADMIN');
  const reception = await mkUser('recepcion@novacare.co', 'Andrés Torres', 'RECEPTIONIST');
  await mkUser('owner@alejandro.ai', 'Alejandro Polanco', 'SUPER_ADMIN', { isSuperAdmin: true });
  const drCarlosUser = await mkUser('carlos.perez@novacare.co', 'Dr. Carlos Pérez', 'DOCTOR');

  const specs = await db
    .insert(s.specialties)
    .values([
      { ...C, name: 'Cardiología', nameEn: 'Cardiology', slug: 'cardiologia', keywords: ['cardiologia', 'cardiologo', 'corazon', 'heart', 'cardiology', 'presion', 'electrocardiograma'], description: 'Valoración y seguimiento cardiovascular.' },
      { ...C, name: 'Dermatología', nameEn: 'Dermatology', slug: 'dermatologia', keywords: ['dermatologia', 'dermatologo', 'dermatologa', 'piel', 'skin', 'dermatology', 'acne', 'lunar'], description: 'Salud de la piel, cabello y uñas.' },
      { ...C, name: 'Ortopedia', nameEn: 'Orthopedics', slug: 'ortopedia', keywords: ['ortopedia', 'ortopedista', 'hueso', 'rodilla', 'orthopedics', 'traumatologia', 'articulacion'], description: 'Huesos, articulaciones y lesiones deportivas.' },
    ])
    .returning();
  const [cardio, derma, orto] = specs;

  const svc = await db
    .insert(s.services)
    .values([
      { ...C, specialtyId: cardio.id, name: 'Consulta de cardiología', nameEn: 'Cardiology consultation', durationMinutes: 40, priceCents: 18000000, currency: 'COP', description: 'Valoración cardiovascular con el especialista.' },
      { ...C, specialtyId: cardio.id, name: 'Electrocardiograma (ECG)', nameEn: 'Electrocardiogram (ECG)', durationMinutes: 30, priceCents: 9500000, currency: 'COP', description: 'Registro de la actividad eléctrica del corazón.' },
      { ...C, specialtyId: cardio.id, name: 'Ecocardiograma', nameEn: 'Echocardiogram', durationMinutes: 45, priceCents: null, currency: 'COP', description: 'Ecografía del corazón. Precio según plan y orden médica.' },
      { ...C, specialtyId: derma.id, name: 'Consulta dermatológica', nameEn: 'Dermatology consultation', durationMinutes: 30, priceCents: 15000000, currency: 'COP', description: 'Valoración de piel, cabello y uñas.' },
      { ...C, specialtyId: derma.id, name: 'Control de lunares (dermatoscopia)', nameEn: 'Mole check (dermoscopy)', durationMinutes: 30, priceCents: 12000000, currency: 'COP', description: 'Revisión de lunares con dermatoscopio.' },
      { ...C, specialtyId: derma.id, name: 'Tratamiento de acné', nameEn: 'Acne treatment', durationMinutes: 30, priceCents: 16000000, currency: 'COP', description: 'Consulta y plan de manejo del acné.' },
      { ...C, specialtyId: orto.id, name: 'Consulta de ortopedia', nameEn: 'Orthopedics consultation', durationMinutes: 40, priceCents: 17000000, currency: 'COP', description: 'Valoración de huesos y articulaciones.' },
      { ...C, specialtyId: orto.id, name: 'Valoración de rodilla', nameEn: 'Knee assessment', durationMinutes: 40, priceCents: 17000000, currency: 'COP', description: 'Evaluación especializada de rodilla.' },
      { ...C, specialtyId: orto.id, name: 'Infiltración articular', nameEn: 'Joint injection', durationMinutes: 30, priceCents: null, currency: 'COP', description: 'Procedimiento ambulatorio. Precio según medicamento indicado.' },
    ])
    .returning();

  const doctorDefs = [
    { title: 'Dr.', firstName: 'Carlos', lastName: 'Pérez', specialtyId: cardio.id, locationId: chico.id, userId: drCarlosUser.id, color: '#e11d48', languages: ['es', 'en'], duration: 40, email: 'carlos.perez@novacare.co',
      bio: 'Cardiólogo clínico con 15 años de experiencia en prevención cardiovascular e hipertensión. Universidad Nacional de Colombia.',
      schedule: [1, 2, 3, 4, 5].flatMap((d) => [{ dayOfWeek: d, startTime: '08:00', endTime: '12:00' }, { dayOfWeek: d, startTime: '14:00', endTime: '17:00' }]) },
    { title: 'Dra.', firstName: 'María', lastName: 'García', specialtyId: derma.id, locationId: chico.id, userId: null, color: '#7c3aed', languages: ['es'], duration: 30, email: 'maria.garcia@novacare.co',
      bio: 'Dermatóloga especialista en dermatología clínica y dermatoscopia. Pontificia Universidad Javeriana.',
      schedule: [
        ...[1, 3, 4, 5].flatMap((d) => [{ dayOfWeek: d, startTime: '08:00', endTime: '12:00' }, { dayOfWeek: d, startTime: '14:00', endTime: '18:00' }]),
        { dayOfWeek: 2, startTime: '14:00', endTime: '18:00' },
        { dayOfWeek: 6, startTime: '08:00', endTime: '12:00' },
      ] },
    { title: 'Dr.', firstName: 'Juan', lastName: 'Rodríguez', specialtyId: orto.id, locationId: usaquen.id, userId: null, color: '#0891b2', languages: ['es', 'en'], duration: 40, email: 'juan.rodriguez@novacare.co',
      bio: 'Ortopedista y traumatólogo, subespecialista en rodilla y medicina deportiva. Universidad del Rosario.',
      schedule: [
        ...[2, 4].map((d) => ({ dayOfWeek: d, startTime: '07:00', endTime: '13:00' })),
        ...[1, 3, 5].map((d) => ({ dayOfWeek: d, startTime: '14:00', endTime: '19:00' })),
      ] },
  ];
  const docs: (typeof s.doctors.$inferSelect & { schedule: { dayOfWeek: number; startTime: string; endTime: string }[] })[] = [];
  for (const d of doctorDefs) {
    const [row] = await db
      .insert(s.doctors)
      .values({ ...C, title: d.title, firstName: d.firstName, lastName: d.lastName, specialtyId: d.specialtyId, locationId: d.locationId, userId: d.userId, color: d.color, languages: d.languages, defaultDurationMinutes: d.duration, email: d.email, phone: '+57 601 745 2200', bio: d.bio })
      .returning();
    await db.insert(s.doctorSchedules).values(d.schedule.map((x) => ({ ...O, doctorId: row.id, ...x })));
    const own = svc.filter((x) => x.specialtyId === d.specialtyId);
    await db.insert(s.doctorServices).values(own.map((x) => ({ doctorId: row.id, serviceId: x.id })));
    docs.push({ ...row, schedule: d.schedule });
  }
  const [drCarlos, drMaria, drJuan] = docs;
  // Vacation block for Dra. García in ~3 weeks, and a lunch meeting block for Dr. Pérez.
  const vac = now.plus({ weeks: 3 }).startOf('week');
  await db.insert(s.timeOff).values([
    { ...O, doctorId: drMaria.id, type: 'VACATION', startsAt: vac.toJSDate(), endsAt: vac.plus({ days: 5 }).toJSDate(), reason: 'Congreso de Dermatología' },
    { ...O, doctorId: drCarlos.id, type: 'BLOCK', startsAt: now.plus({ days: 2 }).set({ hour: 8, minute: 0 }).toJSDate(), endsAt: now.plus({ days: 2 }).set({ hour: 9, minute: 20 }).toJSDate(), reason: 'Junta médica' },
  ]);
  await db.insert(s.calendarIntegrations).values({ ...C, provider: 'MOCK', externalCalendarId: 'clinic', accountEmail: 'agenda@novacare.co' });

  // ── Patients ──
  log('→ Patients');
  const patientRows: (typeof s.patients.$inferSelect)[] = [];
  const [maria] = await db
    .insert(s.patients)
    .values({ ...C, firstName: 'María', lastName: 'Rodríguez', email: 'maria.rodriguez@example.com', phone: '+573001234567', documentId: 'CC 52.345.678', dateOfBirth: '1988-04-12', gender: 'F', preferredLanguage: 'es', tags: ['prepagada', 'frecuente'], source: 'HUMAN', preferences: { preferredContactChannel: 'WHATSAPP' } })
    .returning();
  patientRows.push(maria);
  const [john] = await db
    .insert(s.patients)
    .values({ ...C, firstName: 'John', lastName: 'Miller', email: 'john.miller@example.com', phone: '+13055550142', preferredLanguage: 'en', tags: ['international'], source: 'WEB' })
    .returning();
  patientRows.push(john);
  const used = new Set(['María Rodríguez']);
  while (patientRows.length < 46) {
    const f = pick(FIRST);
    const l = `${pick(LAST)} ${pick(LAST)}`;
    if (used.has(`${f} ${l}`)) continue;
    used.add(`${f} ${l}`);
    const slug = `${f}.${l.split(' ')[0]}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const [p] = await db
      .insert(s.patients)
      .values({
        ...C,
        firstName: f,
        lastName: l,
        email: chance(0.85) ? `${slug}${Math.floor(rand() * 90 + 10)}@example.com` : null,
        phone: `+573${Math.floor(rand() * 2 + 0)}${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`,
        documentId: `CC ${Math.floor(rand() * 9e7 + 1e7)}`,
        dateOfBirth: `${1955 + Math.floor(rand() * 50)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
        gender: pick(['F', 'M']),
        preferredLanguage: chance(0.08) ? 'en' : 'es',
        tags: chance(0.4) ? [pick(['prepagada', 'particular', 'frecuente', 'nuevo'])] : [],
        source: pick(['HUMAN', 'AI', 'WHATSAPP', 'WEB']),
        createdAt: now.minus({ days: Math.floor(rand() * 120) }).toJSDate(),
      })
      .returning();
    patientRows.push(p);
  }
  // Portal account for María Rodríguez
  const [mariaUser] = await db.insert(s.users).values({ email: 'maria.rodriguez@example.com', name: 'María Rodríguez', passwordHash: hash }).returning();
  await db.insert(s.memberships).values({ userId: mariaUser.id, organizationId: org.id, clinicId: clinic.id, roleId: roleId.get('PATIENT')! });
  await db.update(s.patients).set({ userId: mariaUser.id }).where(sql`id = ${maria.id}`);

  // ── Appointments (non-overlapping by construction) ──
  log('→ Appointments');
  const apptValues: (typeof s.appointments.$inferInsert)[] = [];
  const sources = ['HUMAN', 'HUMAN', 'HUMAN', 'HUMAN', 'HUMAN', 'HUMAN', 'HUMAN', 'HUMAN', 'AI', 'AI', 'WHATSAPP', 'WEB', 'WEB', 'API'] as const;
  for (let offset = -60; offset <= 14; offset++) {
    const day = now.plus({ days: offset }).startOf('day');
    for (const d of docs) {
      const dur = d.defaultDurationMinutes;
      for (const iv of d.schedule.filter((x) => x.dayOfWeek === day.weekday)) {
        const [sh, sm] = iv.startTime.split(':').map(Number);
        const [eh, em] = iv.endTime.split(':').map(Number);
        let cursor = day.set({ hour: sh, minute: sm });
        const end = day.set({ hour: eh, minute: em });
        while (cursor.plus({ minutes: dur }) <= end) {
          const isPast = cursor < now;
          const fill = offset === 0 ? 0.55 : isPast ? (offset < -30 ? 0.4 : 0.5) : offset <= 3 ? 0.42 : 0.3;
          if (chance(fill)) {
            const patient = pick(patientRows.slice(2));
            const service = pick(svc.filter((x) => x.specialtyId === d.specialtyId && x.durationMinutes <= dur));
            let status: (typeof s.appointmentStatus.enumValues)[number] = 'CONFIRMED';
            if (isPast) status = chance(0.82) ? 'COMPLETED' : chance(0.5) ? 'NO_SHOW' : 'CANCELLED';
            else if (chance(0.06)) status = 'CANCELLED';
            else if (chance(0.08)) status = 'PENDING';
            const source = pick([...sources]);
            apptValues.push({
              ...C,
              doctorId: d.id,
              patientId: patient.id,
              serviceId: service?.id ?? null,
              locationId: d.locationId,
              startTime: cursor.toJSDate(),
              endTime: cursor.plus({ minutes: service?.durationMinutes ?? dur }).toJSDate(),
              status,
              source,
              createdByType: source === 'HUMAN' ? 'USER' : source === 'API' ? 'SYSTEM' : source === 'WEB' ? 'PATIENT' : 'AI_AGENT',
              createdById: source === 'HUMAN' ? reception.id : null,
              calendarEventId: `mock_evt_seed_${apptValues.length}`,
              cancelledAt: status === 'CANCELLED' ? cursor.minus({ days: 1 }).toJSDate() : null,
              cancellationReason: status === 'CANCELLED' ? pick(['Viaje imprevisto', 'Motivos laborales', 'Se siente mejor', 'Cambio de ciudad']) : null,
              createdAt: DateTime.min(cursor.minus({ days: Math.floor(rand() * 10) + 1 }), now).toJSDate(),
            });
          }
          cursor = cursor.plus({ minutes: dur });
        }
      }
    }
  }
  // María Rodríguez: one upcoming dermatology appointment (demo: "Quiero cancelar mi cita") + one past cardiology visit.
  const findFree = (doc: (typeof docs)[number], fromDays: number) => {
    for (let o = fromDays; o < fromDays + 20; o++) {
      const day = now.plus({ days: o }).startOf('day');
      for (const iv of doc.schedule.filter((x) => x.dayOfWeek === day.weekday)) {
        const [sh, sm] = iv.startTime.split(':').map(Number);
        const [eh, em] = iv.endTime.split(':').map(Number);
        let c = day.set({ hour: sh, minute: sm });
        while (c.plus({ minutes: doc.defaultDurationMinutes }) <= day.set({ hour: eh, minute: em })) {
          const st = c.toJSDate().getTime();
          const en = st + doc.defaultDurationMinutes * 60_000;
          const clash = apptValues.some((a) => a.doctorId === doc.id && ['CONFIRMED', 'PENDING'].includes(a.status!) && (a.startTime as Date).getTime() < en && st < (a.endTime as Date).getTime());
          if (!clash && c > now.plus({ hours: 3 })) return c;
          c = c.plus({ minutes: doc.defaultDurationMinutes });
        }
      }
    }
    throw new Error('No free slot for demo appointment');
  };
  const mariaSlot = findFree(drJuan, 6);
  apptValues.push({ ...C, doctorId: drJuan.id, patientId: maria.id, serviceId: svc.find((x) => x.name === 'Valoración de rodilla')!.id, locationId: drJuan.locationId, startTime: mariaSlot.toJSDate(), endTime: mariaSlot.plus({ minutes: 40 }).toJSDate(), status: 'CONFIRMED', source: 'WHATSAPP', createdByType: 'AI_AGENT', calendarEventId: 'mock_evt_maria_1', createdAt: now.minus({ days: 2 }).toJSDate() });
  apptValues.push({ ...C, doctorId: drCarlos.id, patientId: maria.id, serviceId: svc[0].id, locationId: drCarlos.locationId, startTime: now.minus({ days: 40 }).set({ hour: 9, minute: 20 }).toJSDate(), endTime: now.minus({ days: 40 }).set({ hour: 10, minute: 0 }).toJSDate(), status: 'COMPLETED', source: 'HUMAN', createdByType: 'USER', createdAt: now.minus({ days: 50 }).toJSDate() });
  const johnSlot = findFree(drCarlos, 9);
  apptValues.push({ ...C, doctorId: drCarlos.id, patientId: john.id, serviceId: svc[1].id, locationId: drCarlos.locationId, startTime: johnSlot.toJSDate(), endTime: johnSlot.plus({ minutes: 30 }).toJSDate(), status: 'CONFIRMED', source: 'AI', createdByType: 'AI_AGENT', createdAt: now.minus({ days: 1 }).toJSDate() });
  for (let i = 0; i < apptValues.length; i += 200) await db.insert(s.appointments).values(apptValues.slice(i, i + 200));
  log(`   ${apptValues.length} appointments`);

  // ── AI agent ──
  const [agent] = await db
    .insert(s.agents)
    .values({
      ...C,
      name: 'Alejandro AI',
      welcomeMessage: '¡Hola! Soy Alejandro AI, el asistente de NovaCare Medical Center. Puedo ayudarte a agendar, reprogramar o cancelar citas y resolver dudas sobre la clínica. ¿En qué te ayudo?',
      welcomeMessageEn: "Hi! I'm Alejandro AI, NovaCare Medical Center's assistant. I can help you book, reschedule or cancel appointments and answer questions about the clinic. How can I help?",
      tone: 'friendly_professional',
      languages: ['es', 'en'],
      handoffRules: DEFAULT_HANDOFF_RULES,
      bookingRules: { ...DEFAULT_BOOKING_RULES, maxSlotsToOffer: 6 },
      notificationRules: DEFAULT_NOTIFICATION_RULES,
      cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
      systemPromptExtra: 'La clínica no tiene servicio de urgencias ni pediatría. Menciona que los precios están en pesos colombianos (COP).',
    })
    .returning();

  // ── Knowledge base ──
  log('→ Knowledge base (chunk + embed)');
  const embedder = new LocalEmbeddingProvider();
  const addSource = async (title: string, type: 'TEXT' | 'FAQ', category: string, rawText: string, chunks: ReturnType<typeof chunkText>, metadata: Record<string, unknown> = {}) => {
    const [src] = await db.insert(s.knowledgeSources).values({ ...C, title, type, category, rawText, status: 'INDEXED', chunkCount: chunks.length, processedAt: now.minus({ days: 20 }).toJSDate(), createdById: admin.id, metadata }).returning();
    const vecs = await embedder.embed(chunks.map((c) => `${title}\n${c.heading ?? ''}\n${c.content}`));
    await db.insert(s.knowledgeChunks).values(chunks.map((c, i) => ({ ...C, sourceId: src.id, index: c.index, content: c.content, tokenCount: tokenCount(c.content), metadata: { heading: c.heading, title, category }, embeddingModel: embedder.model, embedding: vecs[i] })));
  };
  for (const k of KNOWLEDGE_TEXTS) {
    const text = normalizeText(k.text);
    await addSource(k.title, 'TEXT', k.category, text, chunkText(text));
  }
  await addSource('Preguntas frecuentes', 'FAQ', 'faq', KNOWLEDGE_FAQ.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n\n'), faqToChunks(KNOWLEDGE_FAQ), { faq: KNOWLEDGE_FAQ });
  await db.insert(s.knowledgeSources).values({ ...C, title: 'Tarifas 2025 (versión anterior)', type: 'TEXT', category: 'precios', status: 'DISABLED', isEnabled: false, rawText: 'Documento archivado.', chunkCount: 0, createdById: admin.id });
  await db.insert(s.knowledgeSources).values({ ...C, title: 'Convenios empresariales.pdf', type: 'PDF', category: 'convenios', status: 'FAILED', fileName: 'convenios-empresariales.pdf', mimeType: 'application/pdf', sizeBytes: 482113, error: 'No readable text found in the document (scanned PDF without OCR)', createdById: admin.id });

  // ── Conversations, messages, tool executions, handoffs ──
  log('→ Conversations');
  type Script = { intent: string; category: string; user: string; assistant: string; tools: string[]; booked?: boolean; handoff?: { reason: string; urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }; unanswered?: boolean; lang?: 'es' | 'en' };
  const scripts: Script[] = [
    { intent: 'book_appointment', category: 'APPOINTMENT', user: 'Hola, necesito una cita con dermatología para esta semana', assistant: 'Claro. Tengo estos horarios disponibles con Dra. María García esta semana. Elige uno para reservarlo:', tools: ['getDoctors', 'getAvailableAppointmentSlots', 'createAppointment'], booked: true },
    { intent: 'book_appointment', category: 'APPOINTMENT', user: 'Quiero una cita con el cardiólogo el jueves en la mañana', assistant: 'Claro. Tengo estos horarios disponibles con Dr. Carlos Pérez. Elige uno para reservarlo:', tools: ['getDoctors', 'getAvailableAppointmentSlots', 'createAppointment'], booked: true },
    { intent: 'book_appointment', category: 'APPOINTMENT', user: 'Me duele la rodilla desde hace semanas, ¿puedo ver al ortopedista?', assistant: 'Entiendo. No puedo darte un diagnóstico, pero sí agendarte con Dr. Juan Rodríguez (Ortopedia). Estos son sus horarios:', tools: ['getDoctors', 'getAvailableAppointmentSlots', 'createAppointment'], booked: true },
    { intent: 'services_info', category: 'GENERAL_INFORMATION', user: '¿Qué servicios ofrece la clínica?', assistant: 'Según la información de NovaCare: ofrecemos Cardiología, Dermatología y Ortopedia con cita previa en Chicó y Usaquén.', tools: ['searchClinicKnowledge', 'getServices'] },
    { intent: 'pricing', category: 'BILLING', user: '¿Cuánto cuesta la consulta dermatológica?', assistant: 'La consulta dermatológica tiene un valor de $150.000 y dura aproximadamente 30 minutos.', tools: ['getServiceInformation'] },
    { intent: 'billing', category: 'BILLING', user: '¿Reciben medicina prepagada Colsanitas?', assistant: 'Sí, tenemos convenio con Colsanitas, Medisanitas, Allianz y Sura Medicina Prepagada.', tools: ['searchClinicKnowledge'] },
    { intent: 'cancel_appointment', category: 'APPOINTMENT', user: 'Necesito cancelar mi cita del viernes', assistant: 'Tu cita quedó cancelada. ¿Quieres agendar una nueva fecha?', tools: ['listPatientAppointments', 'cancelAppointment'] },
    { intent: 'reschedule_appointment', category: 'APPOINTMENT', user: '¿Puedo cambiar mi cita para la próxima semana?', assistant: '¡Listo! Tu cita quedó reprogramada.', tools: ['listPatientAppointments', 'getDoctorAvailability', 'rescheduleAppointment'] },
    { intent: 'hours', category: 'GENERAL_INFORMATION', user: '¿A qué hora abren los sábados?', assistant: 'Los sábados atendemos de 8:00 a. m. a 12:00 m.', tools: ['getBusinessHours'] },
    { intent: 'location', category: 'GENERAL_INFORMATION', user: '¿Dónde queda la sede de Usaquén?', assistant: 'La Sede Usaquén está en la Carrera 7 #120-20, Piso 3.', tools: ['getClinicLocations'] },
    { intent: 'general_question', category: 'GENERAL_INFORMATION', user: '¿Tienen convenio con la EPS Sanitas?', assistant: 'Actualmente no atendemos por EPS del régimen contributivo; la consulta se atendería como particular.', tools: ['searchClinicKnowledge'] },
    { intent: 'general_question', category: 'GENERAL_INFORMATION', user: '¿Hacen exámenes de sangre?', assistant: 'No tengo esa información confirmada en este momento. ¿Quieres que te comunique con recepción?', tools: ['searchClinicKnowledge'], unanswered: true },
    { intent: 'general_question', category: 'GENERAL_INFORMATION', user: '¿Tienen servicio de nutrición?', assistant: 'No tengo esa información confirmada en este momento. ¿Quieres que te comunique con recepción?', tools: ['searchClinicKnowledge'], unanswered: true },
    { intent: 'human', category: 'HUMAN_HANDOFF', user: 'Quiero hablar con una persona por favor', assistant: 'Listo. Ya le avisé a nuestro equipo de recepción: una persona continuará esta conversación en breve.', tools: ['requestHumanHandoff'], handoff: { reason: 'El usuario pidió hablar con una persona', urgency: 'MEDIUM' } },
    { intent: 'support', category: 'SUPPORT', user: 'Tengo una queja, me cobraron dos veces la consulta', assistant: 'Lamento lo ocurrido. Ya le avisé a nuestro equipo para que revise el cobro contigo.', tools: ['requestHumanHandoff'], handoff: { reason: 'Queja o asunto administrativo sensible', urgency: 'HIGH' } },
    { intent: 'medical_advice', category: 'MEDICAL_SAFETY', user: '¿Qué crema me pongo para una mancha en la cara?', assistant: 'No puedo dar diagnósticos ni recomendar tratamientos. Puedo ayudarte a agendar con Dermatología.', tools: [] },
    { intent: 'book_appointment', category: 'APPOINTMENT', user: 'Hi, I need an appointment with a cardiologist next week', assistant: 'Sure. I have these available times with Dr. Carlos Pérez. Pick one to book it:', tools: ['getDoctors', 'getAvailableAppointmentSlots', 'createPatient', 'createAppointment'], booked: true, lang: 'en' },
    { intent: 'services_info', category: 'GENERAL_INFORMATION', user: 'Do you offer telemedicine?', assistant: "According to NovaCare's information: follow-up visits in Dermatology and Cardiology can be done by video call when authorized.", tools: ['searchClinicKnowledge'], lang: 'en' },
  ];
  const channels = ['WEB', 'WHATSAPP', 'WHATSAPP', 'PORTAL', 'WEB'] as const;
  const bookedAppts = apptValues.filter((a) => a.source === 'AI' || a.source === 'WHATSAPP');
  let handoffCount = 0;
  let openHandoffs = 0;
  for (let i = 0; i < 170; i++) {
    const sc = i < scripts.length ? scripts[i] : pick(scripts.filter((x) => !x.handoff || chance(0.6)));
    const ageDays = i < 110 ? Math.floor(rand() * 29) : 30 + Math.floor(rand() * 29);
    const createdAt = now.minus({ days: ageDays, hours: Math.floor(rand() * 10), minutes: Math.floor(rand() * 60) });
    const patient = chance(0.8) ? pick(patientRows) : null;
    const channel = pick([...channels]);
    const lang = sc.lang ?? 'es';
    const handoff = sc.handoff;
    const status = handoff ? (openHandoffs++ < 3 ? 'HANDOFF' : 'RESOLVED') : chance(0.7) ? 'RESOLVED' : 'ACTIVE';
    const [conv] = await db
      .insert(s.conversations)
      .values({
        ...C,
        patientId: patient?.id ?? null,
        channel,
        status,
        language: lang,
        subject: sc.user.slice(0, 120),
        externalContact: channel === 'WHATSAPP' ? (patient?.phone ?? `+5731${Math.floor(rand() * 1e8)}`) : null,
        aiEnabled: !handoff || status !== 'HANDOFF',
        resolvedByAi: !handoff && !sc.unanswered,
        hasBooking: Boolean(sc.booked),
        lastMessageAt: createdAt.plus({ minutes: 3 }).toJSDate(),
        createdAt: createdAt.toJSDate(),
        metadata: { metered: true },
      })
      .returning();
    const welcome = lang === 'en' ? agent.welcomeMessageEn : agent.welcomeMessage;
    const lat = 700 + Math.floor(rand() * 1600);
    await db.insert(s.messages).values([
      { ...O, conversationId: conv.id, role: 'ASSISTANT', content: welcome, language: lang, createdAt: createdAt.toJSDate() },
      { ...O, conversationId: conv.id, role: 'USER', content: sc.user, intent: sc.intent, category: sc.category, language: lang, createdAt: createdAt.plus({ seconds: 20 }).toJSDate() },
      {
        ...O,
        conversationId: conv.id,
        role: 'ASSISTANT',
        content: sc.assistant,
        intent: sc.intent,
        category: sc.category,
        language: lang,
        unanswered: Boolean(sc.unanswered),
        tokensIn: 1800 + Math.floor(rand() * 900),
        tokensOut: 90 + Math.floor(rand() * 120),
        latencyMs: lat,
        trace: { seeded: true, intent: sc.intent, provider: 'mock', model: 'alejandro-mock-1', steps: sc.tools.map((t) => ({ type: 'tool', name: t, status: 'SUCCESS', latencyMs: 20 + Math.floor(rand() * 120) })) },
        createdAt: createdAt.plus({ seconds: 22 }).toJSDate(),
      },
    ]);
    if (sc.tools.length)
      await db.insert(s.toolExecutions).values(
        sc.tools.map((t, k) => ({
          ...O,
          conversationId: conv.id,
          toolName: t,
          input: {},
          output: t === 'searchClinicKnowledge' ? { found: !sc.unanswered, results: [] } : { ok: true },
          status: (chance(0.03) ? 'ERROR' : 'SUCCESS') as 'SUCCESS' | 'ERROR',
          latencyMs: 15 + Math.floor(rand() * 180),
          createdAt: createdAt.plus({ seconds: 21 + k }).toJSDate(),
        })),
      );
    if (sc.booked && bookedAppts.length) {
      const appt = bookedAppts.pop()!;
      appt.conversationId = conv.id;
    }
    if (handoff) {
      handoffCount++;
      await db.insert(s.handoffs).values({
        ...C,
        conversationId: conv.id,
        reason: handoff.reason,
        urgency: handoff.urgency,
        status: status === 'HANDOFF' ? (chance(0.3) ? 'ASSIGNED' : 'OPEN') : 'RESOLVED',
        assignedToId: status === 'HANDOFF' && chance(0.3) ? reception.id : status === 'RESOLVED' ? reception.id : null,
        resolvedAt: status === 'RESOLVED' ? createdAt.plus({ minutes: 25 }).toJSDate() : null,
        summary: {
          summary: `${patient ? `${patient.firstName} ${patient.lastName}` : 'Un usuario no identificado'} contactó a la clínica por ${channel.toLowerCase()}. Intención principal: ${sc.intent === 'support' ? 'Soporte / queja' : 'Hablar con una persona'}.`,
          intent: sc.intent,
          patient: patient ? { id: patient.id, name: `${patient.firstName} ${patient.lastName}` } : null,
          actionsTaken: [],
          pendingActions: [`Atender: ${handoff.reason}`],
          relevantData: { channel, language: lang, lastMessage: sc.user },
          recommendation: sc.intent === 'support' ? 'Revisar la queja o incidencia y responder de forma personalizada.' : 'Contactar al usuario y resolver su solicitud.',
        },
        createdAt: createdAt.plus({ seconds: 25 }).toJSDate(),
      });
    }
    await db.insert(s.usageRecords).values([
      { ...O, clinicId: clinic.id, conversationId: conv.id, kind: 'AI_CONVERSATION', provider: 'mock', createdAt: createdAt.toJSDate() },
      { ...O, clinicId: clinic.id, conversationId: conv.id, kind: 'AI_COMPLETION', provider: 'openai', model: 'gpt-4o-mini', tokensIn: 2100, tokensOut: 160, latencyMs: lat, costMicroUsd: Math.round(2100 * 0.15 + 160 * 0.6), createdAt: createdAt.toJSDate() },
    ]);
  }
  // Persist conversation links for AI-booked appointments.
  for (const a of apptValues.filter((x) => x.conversationId && x.calendarEventId)) {
    await db.execute(sql`update appointments set conversation_id = ${a.conversationId} where calendar_event_id = ${a.calendarEventId} and doctor_id = ${a.doctorId}`);
  }
  log(`   170 conversations, ${handoffCount} handoffs`);

  // ── Leads, tickets, notifications, audit ──
  await db.insert(s.leads).values([
    { ...C, name: 'Daniel Herrera', phone: '+573115559012', interest: 'Chequeo cardiológico ejecutivo', status: 'NEW', source: 'WEB' },
    { ...C, name: 'Lucía Fernández', email: 'lucia.f@example.com', interest: 'Tratamiento de acné', status: 'CONTACTED', source: 'WHATSAPP' },
    { ...C, name: 'Grupo Andino S.A.S.', email: 'rrhh@grupoandino.co', interest: 'Convenio empresarial', status: 'QUALIFIED', source: 'WEB' },
    { ...C, name: 'Pedro Castaño', phone: '+573204441122', interest: 'Valoración de rodilla (running)', status: 'CONVERTED', source: 'AI' },
    { ...C, name: 'Emily Clark', email: 'emily.c@example.com', interest: 'Dermatology consultation in English', status: 'NEW', source: 'WEB' },
  ]);
  await db.insert(s.supportTickets).values([{ ...C, patientId: patientRows[5].id, subject: 'Factura electrónica a nombre de empresa', description: 'Solicita reexpedir la factura con NIT de su empresa.', status: 'OPEN' }]);
  const notifs = [
    { type: 'HUMAN_HANDOFF', title: 'Conversación requiere atención (HIGH)', body: 'Paciente reporta un doble cobro en la consulta.' },
    { type: 'APPOINTMENT_BOOKED', title: 'Cita confirmada', body: 'Alejandro AI agendó una cita de Dermatología con Dra. María García.' },
    { type: 'APPOINTMENT_CANCELLED', title: 'Cita cancelada', body: 'Una cita de Ortopedia del viernes fue cancelada por el paciente.' },
    { type: 'SYSTEM_ALERT', title: 'Documento con error', body: 'El documento "Convenios empresariales.pdf" no pudo procesarse (PDF escaneado sin texto).' },
    { type: 'APPOINTMENT_BOOKED', title: 'Cita confirmada', body: 'Alejandro AI agendó una cita de Cardiología por WhatsApp.' },
  ];
  for (const u of [admin, reception]) {
    await db.insert(s.notifications).values(
      notifs.map((n, i) => ({ ...C, userId: u.id, channel: 'IN_APP' as const, status: 'SENT' as const, ...n, sentAt: now.minus({ hours: i * 5 }).toJSDate(), createdAt: now.minus({ hours: i * 5 }).toJSDate(), readAt: i > 2 ? now.toJSDate() : null })),
    );
  }
  await db.insert(s.auditLogs).values([
    { ...O, actorType: 'USER', actorId: admin.id, actorName: admin.name, action: 'auth.login', createdAt: now.minus({ hours: 2 }).toJSDate() },
    { ...O, actorType: 'AI_AGENT', actorName: 'Alejandro AI', action: 'ai.tool_executed', entityType: 'Tool', entityId: 'createAppointment', patientId: maria.id, metadata: { tool: 'createAppointment' }, createdAt: now.minus({ days: 2 }).toJSDate() },
    { ...O, actorType: 'USER', actorId: admin.id, actorName: admin.name, action: 'knowledge.uploaded', entityType: 'KnowledgeSource', metadata: { title: 'Políticas de la clínica' }, createdAt: now.minus({ days: 20 }).toJSDate() },
    { ...O, actorType: 'USER', actorId: reception.id, actorName: reception.name, action: 'patient.viewed', entityType: 'Patient', entityId: maria.id, patientId: maria.id, createdAt: now.minus({ hours: 5 }).toJSDate() },
    { ...O, actorType: 'WEBHOOK', actorName: 'WhatsApp', action: 'whatsapp.webhook_received', createdAt: now.minus({ hours: 7 }).toJSDate() },
    { ...O, actorType: 'USER', actorId: admin.id, actorName: admin.name, action: 'settings.ai_updated', entityType: 'Agent', entityId: agent.id, metadata: { fields: ['tone', 'languages'] }, createdAt: now.minus({ days: 6 }).toJSDate() },
  ]);

  // ── Billing ──
  const periodStart = now.startOf('month');
  const [sub] = await db
    .insert(s.subscriptions)
    .values({ organizationId: org.id, planId: plan('PROFESSIONAL').id, status: 'ACTIVE', interval: 'MONTHLY', currentPeriodStart: periodStart.toJSDate(), currentPeriodEnd: periodStart.plus({ months: 1 }).toJSDate() })
    .returning();
  await db.insert(s.invoices).values(
    [3, 2, 1, 0].map((m, i) => ({
      organizationId: org.id,
      subscriptionId: sub.id,
      number: `AAI-${periodStart.minus({ months: m }).year}-${String(i + 1).padStart(6, '0')}`,
      amountCents: plan('PROFESSIONAL').priceMonthlyCents,
      status: 'PAID' as const,
      periodStart: periodStart.minus({ months: m }).toJSDate(),
      periodEnd: periodStart.minus({ months: m - 1 }).toJSDate(),
      issuedAt: periodStart.minus({ months: m }).toJSDate(),
      paidAt: periodStart.minus({ months: m }).plus({ hours: 1 }).toJSDate(),
    })),
  );

  // ── Tenant 2: Clínica Aurora (isolation demo) ──
  log('→ Clínica Aurora (second tenant)');
  const [org2] = await db.insert(s.organizations).values({ name: 'Aurora Salud', slug: 'aurora-salud' }).returning();
  const [clinic2] = await db.insert(s.clinics).values({ organizationId: org2.id, name: 'Clínica Aurora', slug: 'aurora', timezone: 'America/Mexico_City', currency: 'MXN', city: 'Ciudad de México', country: 'México', phone: '+52 55 5555 0101', businessHours: { mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']], thu: [['09:00', '18:00']], fri: [['09:00', '18:00']] } }).returning();
  const C2 = { organizationId: org2.id, clinicId: clinic2.id };
  const [u2] = await db.insert(s.users).values({ email: 'admin@aurora.mx', name: 'Rocío Aguilar', passwordHash: hash }).returning();
  await db.insert(s.memberships).values({ userId: u2.id, organizationId: org2.id, clinicId: clinic2.id, roleId: roleId.get('CLINIC_ADMIN')! });
  const [sp2] = await db.insert(s.specialties).values({ ...C2, name: 'Pediatría', nameEn: 'Pediatrics', slug: 'pediatria', keywords: ['pediatria', 'nino'] }).returning();
  const [d2] = await db.insert(s.doctors).values({ ...C2, title: 'Dra.', firstName: 'Elena', lastName: 'Vázquez', specialtyId: sp2.id }).returning();
  await db.insert(s.doctorSchedules).values([1, 2, 3, 4, 5].map((dow) => ({ organizationId: org2.id, doctorId: d2.id, dayOfWeek: dow, startTime: '09:00', endTime: '14:00' })));
  await db.insert(s.patients).values({ ...C2, firstName: 'Diego', lastName: 'Hernández', phone: '+525512345678', email: 'diego.h@example.mx' });
  await db.insert(s.agents).values({ ...C2, handoffRules: DEFAULT_HANDOFF_RULES, bookingRules: DEFAULT_BOOKING_RULES, notificationRules: DEFAULT_NOTIFICATION_RULES });
  await db.insert(s.subscriptions).values({ organizationId: org2.id, planId: plan('STARTER').id, status: 'TRIALING', currentPeriodEnd: now.plus({ days: 10 }).toJSDate(), trialEndsAt: now.plus({ days: 10 }).toJSDate() });

  await pool.end();
  log('\n✔ Seed complete\n');
  log('  Clinic admin : admin@novacare.co        / ' + DEMO_PASSWORD);
  log('  Receptionist : recepcion@novacare.co    / ' + DEMO_PASSWORD);
  log('  Doctor       : carlos.perez@novacare.co / ' + DEMO_PASSWORD);
  log('  Patient      : maria.rodriguez@example.com / ' + DEMO_PASSWORD);
  log('  Other tenant : admin@aurora.mx          / ' + DEMO_PASSWORD);
}

if (require.main === module) {
  runSeed(process.env.DATABASE_URL, { ifEmpty: process.argv.includes('--if-empty') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
