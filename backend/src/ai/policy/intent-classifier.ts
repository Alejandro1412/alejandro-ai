import { DateTime } from 'luxon';
import { norm } from './text';

export type Intent =
  | 'emergency'
  | 'human'
  | 'medical_advice'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'my_appointments'
  | 'book_appointment'
  | 'check_availability'
  | 'pricing'
  | 'hours'
  | 'location'
  | 'doctor_info'
  | 'services_info'
  | 'billing'
  | 'support'
  | 'identify'
  | 'greeting'
  | 'thanks'
  | 'goodbye'
  | 'capabilities'
  | 'preparation'
  | 'join_waitlist'
  | 'confirm_attendance'
  | 'opt_out'
  | 'third_party_data'
  | 'select_option'
  | 'small_talk'
  | 'affirm'
  | 'deny'
  | 'general_question'
  | 'unknown';

export type PolicyCategory =
  | 'ADMINISTRATIVE'
  | 'GENERAL_INFORMATION'
  | 'APPOINTMENT'
  | 'BILLING'
  | 'SUPPORT'
  | 'MEDICAL_SAFETY'
  | 'EMERGENCY'
  | 'HUMAN_HANDOFF';

export interface CatalogEntry {
  id: string;
  name: string;
  nameEn?: string | null;
  keywords?: string[];
}

export interface Catalog {
  specialties: CatalogEntry[];
  doctors: { id: string; firstName: string; lastName: string; specialtyId: string | null }[];
  services: CatalogEntry[];
}

export interface Entities {
  specialtyId?: string;
  specialtyName?: string;
  doctorId?: string;
  doctorName?: string;
  serviceId?: string;
  serviceName?: string;
  dateFrom?: string;
  dateTo?: string;
  dateLabel?: string;
  timeOfDay?: 'MORNING' | 'AFTERNOON';
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** Sub-type for small talk (how_are_you, who_are_you, are_you_bot, joke, compliment, frustration, ack). */
  topic?: string;
}

export interface Classification {
  intent: Intent;
  category: PolicyCategory;
  confidence: number;
  entities: Entities;
  flags: { medicalMention: boolean; complaint: boolean; wantsHuman: boolean; emergency: boolean };
}

const R = {
  thirdParty: /((telefono|celular|numero|correo|email|direccion|datos|historia clinica|citas|informacion) (y (el |la |los |sus )?[a-z ]+ )?(de|del) (la |el )?(paciente|senora|senor|otra persona|mi (hermano|hermana|mama|papa|esposo|esposa|hijo|hija|amigo|amiga))|(phone|email|address|records|appointments|details) of (the )?(patient|another|my (brother|sister|mother|father|wife|husband|friend))|que citas tiene (la |el )?(paciente )?[a-z]+)/,
  waitlist: /(lista de espera|avis(a|e)me (si|cuando) (se libera|hay|haya)|avisenme (si|cuando)|me avisan (si|cuando)|si se libera (un|algun) (cupo|horario|espacio)|wait ?list|notify me (if|when)|let me know (if|when) (a )?(slot|spot|opening))/,
  confirmAttendance: /^(1|confirmo|confirmar|si,? (ahi|alli) estare|ahi estare|alli estare|confirmo (mi )?(asistencia|cita)|i('| wi)ll be there|confirm(ed)?( my (attendance|appointment))?)[.! ]*$/,
  optOut: /^(baja|stop|unsubscribe|no (me )?(envien|manden) mas( mensajes)?|cancelar suscripcion)[.! ]*$/,
  emergency:
    /(dolor (muy )?(fuerte |intenso )?(en el |del )?pecho|chest pain|no puedo respirar|me falta el aire|can'?t breathe|cannot breathe|short(ness)? of breath|me quiero morir|quitarme la vida|suicid|kill myself|end my life|sangrado (abundante|fuerte|mucho|que no para)|heavy bleeding|desmay|perdio el conocimiento|unconscious|fainted|convulsi|seizure|infarto|heart attack|derrame cerebral|\bstroke\b|sobredosis|overdose|envenen|poison|anafila|anaphyla|emergencia|emergency|urgencia vital)/,
  human:
    /(hablar con (una |un )?(persona|humano|alguien|agente|asesor|recepcion|recepcionista|operador|doctor real)|comunicame con|pasame con|atencion humana|persona real|\bhuman\b|real person|talk to (a |an |someone|somebody)|speak (to|with) (a |an |someone|somebody)|representative|operator|live agent)/,
  medical:
    /(diagnost|que enfermedad|enfermedad tengo|me (salen|salio|salieron) (unas? )?(manchas|ronchas|granos|bultos)|que (medicamento|pastilla|remedio|tomo|debo tomar)|que (tengo|me pasa)|es grave|sintoma|me duele|tengo (fiebre|tos|dolor|gripa|gripe|mancha|erupcion|alergia|nauseas|mareo)|dosis|should i take|what (medicine|medication|pill)|diagnos|symptom|is it serious|i have (a )?(rash|fever|pain|cough|headache)|what do i have|resultados? de (examen|laboratorio)|lab results?)/,
  cancel: /(cancel|anular|no (voy a|podre|puedo) (ir|asistir)|can'?t make it)/,
  reschedule: /(reprogram|cambiar (mi |la |de )?(cita|hora|fecha|horario)|mover (mi |la )?cita|otra (fecha|hora)|reschedul|change my appointment|move my appointment|different (time|day))/,
  myAppointments: /(mis citas|\bmi cita\b|tengo (una )?cita|cuando es mi cita|my appointments?|do i have an appointment|upcoming appointment)/,
  book: /(\bcita\b|agendar|agenda |reservar|separar|sacar (una )?cita|\bturno\b|consulta con|quiero ver (a |al )|pedir (una )?hora|appointment|\bbook\b|schedule|see (a |the )?doctor|visit)/,
  availability: /(disponib|horarios? (disponibles?|libres?)|\bcupos?\b|espacio|available|availability|openings|free slot)/,
  pricing: /(precio|costo|cuanto (cuesta|vale|cobran|sale)|\bvalor\b|tarifa|price|\bcost\b|how much|\bfee\b)/,
  hours: /(horario de atencion|a que hora (abren|cierran|atienden)|abren|cierran|horarios? de la clinica|opening hours|business hours|what time do you (open|close)|are you open)/,
  location: /(donde (queda|quedan|estan|se encuentra|se ubica)|direccion|ubicacion|como llego|sedes?\b|address|location|where are you|directions)/,
  doctors: /(medicos|doctores|especialistas|quien(es)? atiende|que doctor|doctors|specialists|who (is|are) the doctor|staff)/,
  services: /(servicios|que ofrece|que ofrecen|que hacen|tratamientos|procedimientos|especialidades|services|what do you offer|treatments|specialties)/,
  billing: /(seguro|\beps\b|prepagada|medicina prepagada|metodos? de pago|pagar|factura|tarjeta|insurance|payment|\bpay\b|invoice|\bbill\b)/,
  policy: /(politica|policy|policies|condiciones|terminos|reglas|cuanto tiempo antes|con cuanta anticipacion|how far in advance|cobran por cancelar|penalidad|penalty|cargo por)/,
  complaint: /(queja|reclamo|mal servicio|molest|inaceptable|complaint|terrible service|unacceptable|refund|reembolso|abogado|lawyer)/,
  support: /(problema|no funciona|error|no puedo (entrar|ingresar)|issue|problem|not working|can'?t log ?in)/,
  greeting: /^(hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|hi|hello|hey|good (morning|afternoon|evening))\b/,
  thanks: /(gracias|thank)/,
  goodbye: /(adios|chao|hasta luego|nos vemos|\bbye\b|see you)/,
  question: /(\?|^(que|como|cual|cuando|donde|puedo|tienen|hacen|atienden|what|how|which|when|where|can|do|does|is|are)\b)/,
  preparation: /(como me preparo|como prepararme|preparo para|preparacion (para|de)|que (debo|tengo que|hay que) llevar|que llevo|debo ir en ayunas|en ayunas|ayuno|how (do|should) i prepare|prepare for (my|the)|what (should|do) i (need to )?bring|fasting)/,
  capabilities: /(que (mas )?puedes hacer|en que (me )?(puedes ayudar|ayudas)|que sabes hacer|para que sirves|como funcionas|que haces\b|what (else )?can you do|how can you help|what do you do|what are you able)/,
  affirm: /^(si|sí|claro|dale|ok|okay|vale|listo|por favor|yes|yep|yeah|sure|please|de acuerdo|perfecto|confirmo|correcto|exacto|eso|esa|ese|confirm|correct|go ahead|hazlo|adelante)\b/,
  deny: /^(no|nop|nope|negativo|mejor no|todavia no|aun no|not yet|no thanks|no gracias|ninguno|ninguna|none)\b/,
};

/** Small-talk topics: answered warmly, then the assistant steers back to what it can do. */
const SMALL_TALK: [string, RegExp][] = [
  ['how_are_you', /(como estas|como te va|que tal estas|como andas|how are you|how'?s it going|how do you do)/],
  ['who_are_you', /(quien eres|que eres\b|como te llamas|cual es tu nombre|who are you|what are you\b|what'?s your name)/],
  ['are_you_bot', /(eres (un |una )?(robot|bot|humano|humana|persona( real)?|maquina|ia|inteligencia artificial)|are you (a )?(bot|robot|human|real person|real|an? ai))/],
  ['joke', /(chiste|algo gracioso|hazme reir|tell me a joke|make me laugh|\bjoke\b)/],
  ['compliment', /(eres (muy |super )?(bueno|buena|genial|lo maximo|util|inteligente|amable)|me encanta(s)?\b|excelente (servicio|atencion)|you('re| are) (great|awesome|smart|helpful|amazing)|love (it|you|this))/],
  ['frustration', /(no (me )?entiendes|no sirves|eres inutil|que (malo|mala)|estupid|tonto|you don'?t understand|useless|stupid|dumb)/],
  ['ack', /^(ok|okay|vale|listo|entendido|perfecto|de acuerdo|got it|alright|cool|genial|bien|super|chevere|bacano)(?:[.! ]|👍)*$/],
];

/** Built-in synonyms that complement the clinic's own specialty keywords. */
const SPECIALTY_SYNONYMS: Record<string, string[]> = {
  derm: ['dermatolog', 'piel', 'skin', 'acne', 'lunar', 'mancha', 'mole'],
  card: ['cardiolog', 'corazon', 'heart', 'presion arterial', 'blood pressure', 'arritmia'],
  orto: ['ortoped', 'hueso', 'rodilla', 'columna', 'fractura', 'bone', 'knee', 'spine', 'orthoped', 'traumatolog'],
  ped: ['pediatr', 'nino', 'nina', 'bebe', 'child', 'kid', 'baby'],
  gin: ['ginecolog', 'gynecolog', 'embarazo', 'pregnan'],
  odo: ['odontolog', 'dental', 'diente', 'muela', 'dentist', 'tooth'],
  gen: ['medicina general', 'general practitioner', 'medico general', 'chequeo', 'check up', 'checkup'],
};

const WEEKDAYS: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};

function categoryOf(intent: Intent): PolicyCategory {
  switch (intent) {
    case 'emergency':
      return 'EMERGENCY';
    case 'medical_advice':
      return 'MEDICAL_SAFETY';
    case 'human':
      return 'HUMAN_HANDOFF';
    case 'book_appointment':
    case 'check_availability':
    case 'join_waitlist':
    case 'confirm_attendance':
    case 'cancel_appointment':
    case 'reschedule_appointment':
    case 'my_appointments':
      return 'APPOINTMENT';
    case 'billing':
    case 'pricing':
      return 'BILLING';
    case 'support':
      return 'SUPPORT';
    case 'services_info':
    case 'preparation':
    case 'doctor_info':
    case 'general_question':
    case 'hours':
    case 'location':
      return 'GENERAL_INFORMATION';
    default:
      return 'ADMINISTRATIVE';
  }
}

export function extractDateRange(t: string, timezone: string, now: Date): Pick<Entities, 'dateFrom' | 'dateTo' | 'dateLabel'> {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const range = (from: DateTime, to: DateTime, label: string) => ({ dateFrom: from.toISO()!, dateTo: to.toISO()!, dateLabel: label });
  // "mañana" as a day (not "en/por la mañana")
  if (/pasado manana|day after tomorrow/.test(t)) return range(today.plus({ days: 2 }), today.plus({ days: 3 }), 'day_after_tomorrow');
  if (/(^|[^a-z])(manana|tomorrow)\b/.test(t) && !/(por|en|de) la manana/.test(t)) return range(today.plus({ days: 1 }), today.plus({ days: 2 }), 'tomorrow');
  if (/\b(hoy|today)\b/.test(t)) return range(today, today.plus({ days: 1 }), 'today');
  if (/(proxima semana|semana que viene|siguiente semana|next week)/.test(t)) {
    const start = today.plus({ weeks: 1 }).startOf('week');
    return range(start, start.plus({ days: 7 }), 'next_week');
  }
  if (/(esta semana|this week|lo que queda de la semana)/.test(t)) {
    const end = today.endOf('week').plus({ milliseconds: 1 });
    // If the week is almost over, include the next 3 days so the patient still gets options.
    const to = end.diff(today, 'days').days < 2 ? today.plus({ days: 4 }) : end;
    return range(today, to, 'this_week');
  }
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      let d = today.set({ weekday: dow as 1 });
      if (d <= today) d = d.plus({ weeks: 1 });
      return range(d, d.plus({ days: 1 }), name);
    }
  }
  return {};
}

function matchEntry(t: string, entries: CatalogEntry[], extra?: Record<string, string[]>): CatalogEntry | undefined {
  for (const e of entries) {
    const names = [e.name, e.nameEn ?? '', ...(e.keywords ?? [])].map(norm).filter((x) => x.length > 2);
    // Stem-ish match: "dermatologia" matches "dermatologo", "dermatology"
    if (names.some((n) => t.includes(n) || (n.length > 6 && t.includes(n.slice(0, n.length - 2))))) return e;
    if (extra) {
      const key = Object.keys(extra).find((k) => names.some((n) => extra[k].some((syn) => n.includes(syn))));
      if (key && extra[key].some((syn) => t.includes(syn))) return e;
    }
  }
  return undefined;
}

export function extractEntities(text: string, catalog: Catalog, timezone: string, now: Date): Entities {
  const t = norm(text);
  const e: Entities = {};
  const specialty = matchEntry(t, catalog.specialties, SPECIALTY_SYNONYMS);
  if (specialty) {
    e.specialtyId = specialty.id;
    e.specialtyName = specialty.name;
  }
  for (const d of catalog.doctors) {
    const last = norm(d.lastName);
    const first = norm(d.firstName);
    if ((last.length > 2 && new RegExp(`\\b${last}\\b`).test(t)) || new RegExp(`\\b(dr|dra|doctor|doctora)\\.? ${first}\\b`).test(t)) {
      e.doctorId = d.id;
      e.doctorName = `${d.firstName} ${d.lastName}`;
      if (!e.specialtyId && d.specialtyId) e.specialtyId = d.specialtyId;
      break;
    }
  }
  const service = catalog.services.find((s) => {
    const words = norm(`${s.name} ${s.nameEn ?? ''}`)
      .split(/[^a-z]+/)
      .filter((w) => w.length > 5 && !['consulta', 'consultation', 'general'].includes(w));
    return words.some((w) => t.includes(w));
  });
  if (service) {
    e.serviceId = service.id;
    e.serviceName = service.name;
  }
  Object.assign(e, extractDateRange(t, timezone, now));
  if (/(por|en|de) la manana|\bmorning\b|temprano|early/.test(t)) e.timeOfDay = 'MORNING';
  else if (/(por|en|de) la tarde|\bafternoon\b|\btarde\b/.test(t)) e.timeOfDay = 'AFTERNOON';

  const phone = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  if (phone) e.phone = phone[1].replace(/[^\d+]/g, '');
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) e.email = email[0].toLowerCase();
  const nameMatch =
    text.match(/(?:[Mm]e llamo|[Mm]i nombre es|[Mm]y name is|I am|I'm|[Ss]oy)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,3})/u) ??
    text.match(/^\s*([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){1,3})\s*[,;-]\s*(?:\+?\d|[\w.+-]+@)/u);
  if (nameMatch) {
    const parts = nameMatch[1].trim().split(/\s+/);
    e.firstName = parts[0];
    e.lastName = parts.slice(1).join(' ') || '';
  }
  return e;
}

/** Rule-based intent + entity classification. Deterministic, explainable and language-aware (ES/EN). */
export function classify(text: string, catalog: Catalog, timezone: string, now = new Date()): Classification {
  const t = norm(text);
  const entities = extractEntities(text, catalog, timezone, now);
  const flags = {
    emergency: R.emergency.test(t),
    wantsHuman: R.human.test(t),
    medicalMention: R.medical.test(t),
    complaint: R.complaint.test(t),
  };
  const bookingish = R.book.test(t) || R.availability.test(t);

  let intent: Intent;
  let confidence = 0.9;
  if (flags.emergency) intent = 'emergency';
  else if (flags.wantsHuman) intent = 'human';
  else if (R.policy.test(t) && (R.cancel.test(t) || R.reschedule.test(t) || R.question.test(t))) intent = 'general_question';
  else if (R.optOut.test(t)) intent = 'opt_out';
  else if (R.thirdParty.test(t)) intent = 'third_party_data';
  else if (R.waitlist.test(t)) intent = 'join_waitlist';
  else if (R.confirmAttendance.test(t) && !/^1$/.test(t)) intent = 'confirm_attendance';
  else if (R.preparation.test(t)) intent = 'preparation';
  else if (R.cancel.test(t) && (R.book.test(t) || R.myAppointments.test(t) || /cancel/.test(t))) intent = 'cancel_appointment';
  else if (R.reschedule.test(t)) intent = 'reschedule_appointment';
  else if (R.myAppointments.test(t) && !/(necesito|quiero|agendar|reservar|need|want|book)/.test(t)) intent = 'my_appointments';
  else if (flags.medicalMention && !bookingish) intent = 'medical_advice';
  else if (R.pricing.test(t)) intent = 'pricing';
  else if (bookingish && (R.availability.test(t) && !R.book.test(t))) intent = 'check_availability';
  else if (bookingish) intent = 'book_appointment';
  else if (R.hours.test(t)) intent = 'hours';
  else if (R.location.test(t)) intent = 'location';
  else if (R.services.test(t)) intent = 'services_info';
  else if (R.doctors.test(t)) intent = 'doctor_info';
  else if (R.billing.test(t)) intent = 'billing';
  else if (flags.complaint || R.support.test(t)) intent = 'support';
  else if ((entities.phone || entities.email) && (entities.firstName || t.split(' ').length <= 8)) intent = 'identify';
  else if (entities.firstName && /(me llamo|mi nombre|my name|soy )/.test(t)) intent = 'identify';
  else if (entities.specialtyId || entities.doctorId) intent = 'book_appointment';
  else if (R.capabilities.test(t)) intent = 'capabilities';
  else if (SMALL_TALK.some(([, re]) => re.test(t))) {
    // "Hola, ¿cómo estás?" is small talk; a bare "Hola" stays a greeting.
    intent = 'small_talk';
    entities.topic = SMALL_TALK.find(([, re]) => re.test(t))![0];
  } else if (R.greeting.test(t) && t.split(' ').length <= 6) intent = 'greeting';
  else if (R.thanks.test(t) && t.split(' ').length <= 8) intent = 'thanks';
  else if (R.goodbye.test(t) && t.split(' ').length <= 8) intent = 'goodbye';
  else if (t.split(' ').length <= 5 && R.affirm.test(t)) intent = 'affirm';
  else if (t.split(' ').length <= 5 && R.deny.test(t)) intent = 'deny';
  else if (R.thanks.test(t)) intent = 'thanks';
  else if (R.goodbye.test(t)) intent = 'goodbye';
  else if (R.question.test(t)) {
    intent = 'general_question';
    confidence = 0.6;
  } else {
    intent = 'unknown';
    confidence = 0.3;
  }
  return { intent, category: categoryOf(intent), confidence, entities, flags };
}
