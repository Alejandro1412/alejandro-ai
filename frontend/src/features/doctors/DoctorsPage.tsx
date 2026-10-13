import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineArrowUpTray, HiOutlineCalendarDays, HiOutlineMapPin, HiOutlineUserGroup, HiPlus } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, PageHeader, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { doctorName } from '@/lib/format';
import type { Doctor, Specialty } from '@/types';
import { CsvImportDialog } from '../patients/CsvImportDialog';
import { DoctorFormDialog } from './DoctorFormDialog';

const DOCTORS_TEMPLATE = [
  'titulo;nombre;apellido;especialidad;duracion;horario;email;telefono',
  'Dra.;Laura;Martínez;Dermatología;30;lun-vie 08:00-12:00 | sab 08:00-12:00;laura.martinez@example.com;+573001234567',
  'Dr.;Andrés;Rojas;Medicina general;20;lun-mie 14:00-18:00;;',
].join('\r\n');

export default function DoctorsPage() {
  const t = useT();
  const { can } = useAuth();
  const [specialtyId, setSpecialtyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api.get<Specialty[]>('/specialties') });
  const q = useQuery({ queryKey: ['doctors', { specialtyId }], queryFn: () => api.get<Doctor[]>('/doctors', { specialtyId }) });

  const scheduleSummary = (d: Doctor) => {
    const days = [...new Set(d.schedules.map((s) => s.dayOfWeek))].sort();
    return days.map((x) => t(`daysShort.${x}` as never)).join(' · ');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('doctors.title')}
        subtitle={t('doctors.subtitle')}
        actions={
          <>
            <Select aria-label={t('doctors.specialty')} value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)} className="w-auto">
              <option value="">{t('common.all')}</option>
              {specialties.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {can('doctors.create') && (
              <>
                <Button variant="secondary" icon={<HiOutlineArrowUpTray aria-hidden="true" />} onClick={() => setImporting(true)}>
                  {t('admin.import.button')}
                </Button>
                <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setCreating(true)}>
                  {t('doctors.new')}
                </Button>
              </>
            )}
          </>
        }
      />
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <div className="card">
          <EmptyState icon={<HiOutlineUserGroup />} title={t('doctors.empty')} body={t('doctors.emptyBody')} action={can('doctors.create') && <Button onClick={() => setCreating(true)}>{t('doctors.new')}</Button>} />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((d) => (
            <li key={d.id}>
              <Link to={`/doctors/${d.id}`} className="card group flex h-full flex-col p-5 transition hover:border-border-strong hover:shadow-pop" data-no-underline>
                <div className="flex items-start gap-3.5">
                  <Avatar name={doctorName(d)} color={d.color} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold group-hover:text-primary">{doctorName(d)}</p>
                    <p className="text-sm text-ink-2">{d.specialty?.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={statusTone(d.status)} dot>
                        {t(`doctorStatus.${d.status}`)}
                      </Badge>
                      {d.calendarProvider && <Badge tone="info">{d.calendarProvider}</Badge>}
                    </div>
                  </div>
                </div>
                {d.bio && <p className="mt-3 line-clamp-2 text-sm text-ink-2">{d.bio}</p>}
                <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-ink-3">{t('doctors.today')}</dt>
                    <dd className="font-display text-xl font-bold">{d.appointmentsToday ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">{t('doctors.services')}</dt>
                    <dd className="font-display text-xl font-bold">{d.services.length}</dd>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 text-xs text-ink-2">
                    <HiOutlineCalendarDays aria-hidden="true" />
                    {scheduleSummary(d) || t('doctors.closed')}
                  </div>
                  {d.location && (
                    <div className="col-span-2 flex items-center gap-1.5 text-xs text-ink-2">
                      <HiOutlineMapPin aria-hidden="true" />
                      {d.location.name}
                    </div>
                  )}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <DoctorFormDialog open={creating} onClose={() => setCreating(false)} />
      <CsvImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        title={t('admin.import.doctorsTitle')}
        endpoint="/doctors/import"
        headersHelp={t('admin.import.doctorsHeaders')}
        note={t('admin.import.doctorsPlanNote')}
        template={DOCTORS_TEMPLATE}
        templateName="plantilla-medicos.csv"
        invalidate={['doctors']}
      />
    </div>
  );
}
