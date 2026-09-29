import { useQuery } from '@tanstack/react-query';
import { HiOutlineChatBubbleOvalLeft, HiOutlineMapPin, HiOutlinePhone, HiOutlinePlusCircle } from 'react-icons/hi2';
import { AgentAvatar } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { doctorName, fmtDateLong, fmtTime } from '@/lib/format';
import type { Appointment, Clinic, Location } from '@/types';

export interface PortalMe {
  patient: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; preferredLanguage: string };
  clinic: Pick<Clinic, 'name' | 'phone' | 'email' | 'address' | 'city' | 'timezone' | 'businessHours'>;
  locations: Location[];
}

export default function PortalHome() {
  const t = useT();
  const { prefs } = usePreferences();
  const me = useQuery({ queryKey: ['portal', 'me'], queryFn: () => api.get<PortalMe>('/portal/me') });
  const appts = useQuery({ queryKey: ['portal', 'appointments'], queryFn: () => api.get<Appointment[]>('/portal/appointments') });
  const tz = me.data?.clinic.timezone;
  const next = appts.data?.filter((a) => (a.status === 'CONFIRMED' || a.status === 'PENDING') && new Date(a.startTime) > new Date()).sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

  if (me.isLoading) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t('portal.hello', { name: me.data?.patient.firstName ?? '' })}</h1>
        <p className="mt-1 text-ink-2">{t('portal.subtitle', { clinic: me.data?.clinic.name ?? '' })}</p>
      </header>

      <Card className="overflow-hidden">
        <CardHeader title={t('portal.nextAppointment')} />
        {appts.isLoading ? (
          <Skeleton className="mx-5 mb-5 h-24" />
        ) : next ? (
          <div className="flex items-start gap-4 px-5 pb-5">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-primary-fg">
              <div className="text-center leading-tight">
                <p className="text-xs uppercase">{new Date(next.startTime).toLocaleDateString(prefs.lang === 'en' ? 'en-US' : 'es-CO', { month: 'short', timeZone: tz })}</p>
                <p className="text-2xl font-bold">{new Date(next.startTime).toLocaleDateString('en-US', { day: 'numeric', timeZone: tz })}</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold cap-first">
                {fmtDateLong(next.startTime, prefs.lang, tz)} · {fmtTime(next.startTime, prefs.lang, tz)}
              </p>
              <p className="text-sm text-ink-2">
                {doctorName(next.doctor)} · {next.service?.name ?? next.doctor.specialty?.name}
              </p>
              {next.location && <p className="text-xs text-ink-3">{next.location.name}</p>}
              <Badge tone={statusTone(next.status)} dot className="mt-2">
                {t(`status.${next.status}` as never)}
              </Badge>
            </div>
          </div>
        ) : (
          <EmptyState title={t('portal.noUpcoming')} className="py-6" action={<ButtonLink to="/portal/book">{t('portal.bookNow')}</ButtonLink>} />
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <ButtonLink to="/portal/book" size="lg" className="h-auto flex-col whitespace-normal py-5 text-center" icon={<HiOutlinePlusCircle className="text-2xl" aria-hidden="true" />}>
          {t('portal.bookNow')}
        </ButtonLink>
        <ButtonLink to="/portal/chat" size="lg" variant="secondary" className="h-auto flex-col whitespace-normal py-5 text-center" icon={<HiOutlineChatBubbleOvalLeft className="text-2xl" aria-hidden="true" />}>
          {t('portal.chatWithAi')}
        </ButtonLink>
      </div>

      <Card>
        <div className="flex items-center gap-3 p-5">
          <AgentAvatar size={44} online />
          <p className="text-sm text-ink-2">{t('portal.remindersNote')}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('portal.clinicInfo')} />
        <ul className="space-y-3 px-5 pb-5 text-sm">
          {me.data?.locations.map((l) => (
            <li key={l.id} className="flex items-start gap-3">
              <Avatar name={l.name} size={32} color="rgb(var(--accent))" />
              <div>
                <p className="font-medium">{l.name}</p>
                <p className="flex items-center gap-1 text-ink-2">
                  <HiOutlineMapPin aria-hidden="true" /> {l.address}
                </p>
                {l.phone && (
                  <a href={`tel:${l.phone}`} className="flex items-center gap-1 text-primary">
                    <HiOutlinePhone aria-hidden="true" /> {l.phone}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
