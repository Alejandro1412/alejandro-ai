import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiMagnifyingGlass, HiOutlineArrowUpTray, HiOutlineUsers, HiPlus } from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Avatar, Badge, Card, PageHeader, Pagination } from '@/components/ui/Display';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fullName } from '@/lib/format';
import type { Patient } from '@/types';
import { CsvImportDialog } from './CsvImportDialog';
import { PatientFormDialog } from './PatientFormDialog';

const PATIENTS_TEMPLATE = [
  'nombre;apellido;telefono;email;documento;fecha_nacimiento;idioma;etiquetas',
  'María;Gómez;+573001112233;maria.gomez@example.com;1020304050;1990-05-14;es;control|vip',
  'John;Smith;+13055550123;john.smith@example.com;;1985-11-02;en;',
].join('\r\n');

export default function PatientsPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const nav = useNavigate();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(input);
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [input]);
  const q = useQuery({ queryKey: ['patients', { search, page }], queryFn: () => api.page<Patient>('/patients', { search, page, pageSize: 20 }), placeholderData: keepPreviousData });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('patients.title')}
        subtitle={t('patients.subtitle')}
        actions={
          can('patients.create') && (
            <>
              <Button variant="secondary" icon={<HiOutlineArrowUpTray aria-hidden="true" />} onClick={() => setImporting(true)}>
                {t('admin.import.button')}
              </Button>
              <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setCreating(true)}>
                {t('patients.new')}
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <div className="relative max-w-md">
            <HiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <Input aria-label={t('common.search')} placeholder={t('common.searchPlaceholder')} className="pl-9" value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
        </div>
        {q.isLoading ? (
          <SkeletonRows rows={8} className="p-4" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<HiOutlineUsers />} title={search ? t('common.noResults') : t('patients.empty')} body={search ? undefined : t('patients.emptyBody')} />
        ) : (
          <>
            <DataTable
              caption={t('patients.title')}
              rows={q.data.items}
              rowKey={(p) => p.id}
              onRowClick={(p) => nav(`/patients/${p.id}`)}
              columns={[
                {
                  key: 'name',
                  header: t('common.name'),
                  cell: (p) => (
                    <div className="flex items-center gap-3">
                      <Avatar name={fullName(p)} size={34} />
                      <div>
                        <p className="font-medium">{fullName(p)}</p>
                        <p className="text-xs text-ink-3">{p.documentId}</p>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'contact',
                  header: t('common.phone'),
                  cell: (p) => (
                    <div>
                      <p>{p.phone ?? '—'}</p>
                      <p className="text-xs text-ink-3">{p.email}</p>
                    </div>
                  ),
                },
                { key: 'appts', header: t('patients.appointments'), hideBelow: 'lg', cell: (p) => <span className="tabular-nums">{p.appointmentCount ?? 0}</span> },
                { key: 'next', header: t('patients.nextAppointment'), cell: (p) => (p.nextAppointment ? fmtDateTime(p.nextAppointment, prefs.lang, me?.clinic.timezone) : <span className="text-ink-3">—</span>) },
                {
                  key: 'tags',
                  header: t('patients.tags'),
                  hideBelow: 'xl',
                  cell: (p) => (
                    <div className="flex flex-wrap gap-1">
                      {p.tags.map((x) => (
                        <Badge key={x}>{x}</Badge>
                      ))}
                    </div>
                  ),
                },
                { key: 'since', header: t('patients.since'), hideBelow: 'xl', cell: (p) => fmtDate(p.createdAt, prefs.lang) },
              ]}
              mobileCard={(p) => (
                <div className="flex items-center gap-3">
                  <Avatar name={fullName(p)} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{fullName(p)}</p>
                    <p className="truncate text-sm text-ink-2">{p.phone ?? p.email}</p>
                    {p.nextAppointment && <p className="text-xs text-primary">{fmtDateTime(p.nextAppointment, prefs.lang, me?.clinic.timezone)}</p>}
                  </div>
                </div>
              )}
            />
            <Pagination page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
      <CsvImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        title={t('admin.import.patientsTitle')}
        endpoint="/patients/import"
        headersHelp={t('admin.import.patientsHeaders')}
        template={PATIENTS_TEMPLATE}
        templateName="plantilla-pacientes.csv"
        invalidate={['patients']}
      />
      <PatientFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(p) => nav(`/patients/${p.id}`)} />
    </div>
  );
}
