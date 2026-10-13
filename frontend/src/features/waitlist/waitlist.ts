import type { Doctor, Patient, Service, Specialty } from '@/types';

export const WAITLIST_STATUSES = ['WAITING', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface WaitlistEntry {
  id: string;
  patientId: string;
  specialtyId: string | null;
  doctorId: string | null;
  serviceId: string | null;
  fromDate: string;
  toDate: string;
  timeOfDay: TimeOfDay | null;
  status: WaitlistStatus;
  offeredStart: string | null;
  offerExpiresAt: string | null;
  appointmentId: string | null;
  source: string;
  notes: string | null;
  createdAt: string;
  patient: Pick<Patient, 'id' | 'firstName' | 'lastName' | 'phone'> | null;
  doctor: Pick<Doctor, 'id' | 'title' | 'firstName' | 'lastName'> | null;
  specialty: Pick<Specialty, 'id' | 'name' | 'nameEn'> | null;
  service: Pick<Service, 'id' | 'name' | 'nameEn'> | null;
}

export function countByStatus(entries: Pick<WaitlistEntry, 'status'>[]): Record<WaitlistStatus, number> {
  const out = Object.fromEntries(WAITLIST_STATUSES.map((s) => [s, 0])) as Record<WaitlistStatus, number>;
  for (const e of entries) if (e.status in out) out[e.status]++;
  return out;
}

/** "1 h 05 min", "12 min", "45 s" — or null once the moment has passed. */
export function formatCountdown(msLeft: number): string | null {
  if (msLeft <= 0) return null;
  const totalSec = Math.floor(msLeft / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${totalSec} s`;
}

/** YYYY-MM-DD in local time. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Range in local days → ISO instants: start of `from` to end of `to`. Null when the range is invalid. */
export function dayRangeToIso(from: string, to: string): { fromDate: string; toDate: string } | null {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T23:59:59`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return null;
  return { fromDate: a.toISOString(), toDate: b.toISOString() };
}
