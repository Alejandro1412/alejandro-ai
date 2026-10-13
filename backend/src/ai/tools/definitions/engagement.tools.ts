import { DateTime } from 'luxon';
import { z } from 'zod';
import { formatWhen } from '../../../common/utils/time';
import { defineTool, ToolFailure } from '../tool';
import type { ToolDeps } from '../tool-deps';
import { AppError } from '../../../common/errors/app-error';

const fail = (err: unknown): never => {
  if (err instanceof AppError) throw new ToolFailure(err.code, err.message);
  throw err;
};

export function engagementTools(d: ToolDeps) {
  const confirmAttendance = defineTool({
    name: 'confirmAttendance',
    description: "Record that the identified patient confirms they will attend one of their upcoming appointments (e.g. after a reminder).",
    input: z.object({ appointmentId: z.string().uuid() }),
    output: z.object({ confirmed: z.boolean(), when: z.string(), doctorName: z.string() }),
    permission: 'appointments.update',
    sideEffect: true,
    requiresPatient: true,
    async execute(input, ctx) {
      await d.appointments.getForPatient(input.appointmentId, ctx.patientId!).catch(fail);
      const a = await d.appointments.confirmAttendance(input.appointmentId, ctx.channel).catch(fail);
      return { confirmed: true, when: formatWhen(a.startTime, ctx.timezone, ctx.language), doctorName: `${a.doctor.title} ${a.doctor.firstName} ${a.doctor.lastName}` };
    },
  });

  const addToWaitlist = defineTool({
    name: 'addToWaitlist',
    description:
      'Put the identified patient on the waitlist when no suitable slot is available. The clinic automatically offers freed slots (first come, first served). Use the specialty or doctor the patient asked for.',
    input: z.object({
      specialty: z.string().max(80).optional(),
      doctorId: z.string().uuid().optional(),
      serviceId: z.string().uuid().optional(),
      fromDate: z.string().datetime({ offset: true }).optional(),
      toDate: z.string().datetime({ offset: true }).optional(),
      timeOfDay: z.enum(['morning', 'afternoon', 'evening']).optional(),
    }),
    output: z.object({ entryId: z.string(), from: z.string(), to: z.string(), target: z.string() }),
    permission: 'appointments.create',
    sideEffect: true,
    requiresPatient: true,
    async execute(input, ctx) {
      let specialtyId: string | null = null;
      let target = '';
      if (input.specialty && !input.doctorId) {
        const q = input.specialty.toLowerCase().slice(0, 6);
        const s = (await d.clinics.listSpecialties()).find((x) => [x.name, x.nameEn ?? '', x.slug].some((n) => n.toLowerCase().includes(q)));
        if (!s) throw new ToolFailure('SPECIALTY_NOT_FOUND', `Unknown specialty ${input.specialty}`);
        specialtyId = s.id;
        target = ctx.language === 'en' ? (s.nameEn ?? s.name) : s.name;
      }
      if (input.doctorId) {
        const doc = await d.doctors.get(input.doctorId).catch(fail);
        target = `${doc.title} ${doc.firstName} ${doc.lastName}`;
      }
      if (!specialtyId && !input.doctorId && !input.serviceId) throw new ToolFailure('TARGET_REQUIRED', 'Ask which specialty or doctor the patient wants');
      const from = input.fromDate ? new Date(input.fromDate) : new Date();
      const to = input.toDate ? new Date(input.toDate) : DateTime.fromJSDate(from).plus({ days: 21 }).toJSDate();
      const entry = await d.engagement
        .addToWaitlist({ patientId: ctx.patientId!, specialtyId, doctorId: input.doctorId ?? null, serviceId: input.serviceId ?? null, fromDate: from, toDate: to, timeOfDay: input.timeOfDay ?? null }, 'AI')
        .catch(fail);
      return { entryId: entry.id, from: formatWhen(from, ctx.timezone, ctx.language), to: formatWhen(to, ctx.timezone, ctx.language), target };
    },
  });

  return [confirmAttendance, addToWaitlist];
}
