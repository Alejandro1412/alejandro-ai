import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineCheckCircle, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, ApiError, errorMessage } from '@/lib/api';
import { doctorName, fmtDateTime, fullName } from '@/lib/format';
import type { Appointment, Doctor, Patient } from '@/types';
import { SlotPicker } from './SlotPicker';
import { skipReasonKey, type Frequency, type SeriesResult } from './v3';

export function NewAppointmentDialog({ open, onClose, defaultPatientId, defaultDoctorId }: { open: boolean; onClose: () => void; defaultPatientId?: string; defaultDoctorId?: string }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState(defaultPatientId ?? '');
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? '');
  const [serviceId, setServiceId] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [frequency, setFrequency] = useState<Frequency | ''>('');
  const [occurrences, setOccurrences] = useState(4);
  const [result, setResult] = useState<SeriesResult | null>(null);
  const [seriesError, setSeriesError] = useState<SeriesResult['skipped'] | null>(null);
  const { prefs } = usePreferences();
  const { me } = useAuth();
  const tz = me?.clinic.timezone;
  const occ = Math.min(24, Math.max(2, Math.round(occurrences) || 2));

  const patients = useQuery({ queryKey: ['patients', 'picker', patientSearch], queryFn: () => api.page<Patient>('/patients', { search: patientSearch, pageSize: 20 }), enabled: open });
  const doctors = useQuery({ queryKey: ['doctors', 'active'], queryFn: () => api.get<Doctor[]>('/doctors', { status: 'ACTIVE' }), enabled: open });
  const doctor = doctors.data?.find((d) => d.id === doctorId);

  const create = useMutation({
    mutationFn: () => api.post<Appointment>('/appointments', { patientId, doctorId, serviceId: serviceId || null, startTime: start, notes: notes || null }),
    onSuccess: () => {
      toast.success(t('appointments.created'));
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['slots'] });
      onClose();
      setStart(null);
      setNotes('');
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });
  const createSeries = useMutation({
    mutationFn: () => api.post<SeriesResult>('/appointments/series', { patientId, doctorId, serviceId: serviceId || null, startTime: start, notes: notes || null, frequency, occurrences: occ }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['slots'] });
      setSeriesError(null);
      setResult(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SERIES_NOT_BOOKABLE') setSeriesError((e.details.skipped as SeriesResult['skipped'] | undefined) ?? []);
      else toast.error(t('common.errorGeneric'), errorMessage(e));
    },
  });
  const close = () => {
    if (result) {
      setStart(null);
      setNotes('');
      setFrequency('');
      setOccurrences(4);
    }
    setResult(null);
    setSeriesError(null);
    onClose();
  };
  const submit = () => (frequency ? createSeries.mutate() : create.mutate());
  const skippedList = (items: SeriesResult['skipped']) => (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {items.map((s) => (
        <li key={s.startTime} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="font-medium cap-first">{fmtDateTime(s.startTime, prefs.lang, tz)}</span>
          <span className="text-ink-3">{t(`growth.appt.skipReason.${skipReasonKey(s.reason)}`)}</span>
        </li>
      ))}
    </ul>
  );

  if (result)
    return (
      <Modal
        open={open}
        onClose={close}
        title={t('growth.appt.seriesResult')}
        size="lg"
        footer={<Button onClick={close}>{t('growth.common.done')}</Button>}
      >
        <div className="space-y-4" role="status">
          <p className="flex items-center gap-2 font-semibold text-success">
            <HiOutlineCheckCircle className="text-xl" aria-hidden="true" />
            {t('growth.appt.seriesBooked', { n: result.booked.length })}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {result.booked.map((b) => (
              <li key={b.id} className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success cap-first">
                {fmtDateTime(b.startTime, prefs.lang, tz)}
              </li>
            ))}
          </ul>
          {result.skipped.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
                <HiOutlineExclamationTriangle aria-hidden="true" />
                {t('growth.appt.seriesSkipped', { n: result.skipped.length })}
              </p>
              {skippedList(result.skipped)}
            </div>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('appointments.new')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!patientId || !doctorId || !start} loading={create.isPending || createSeries.isPending}>
            {frequency ? t('growth.appt.createSeries') : t('common.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('appointments.patient')} required>
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">{t('appointments.selectPatient')}</option>
              {patients.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {fullName(p)} {p.phone ? `· ${p.phone}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.search')}>
            <Input placeholder={t('common.searchPlaceholder')} value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
          </Field>
          <Field label={t('appointments.doctor')} required>
            <Select
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value);
                setServiceId('');
                setStart(null);
              }}
            >
              <option value="">{t('appointments.selectDoctor')}</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {doctorName(d)} · {d.specialty?.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('appointments.service')}>
            <Select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setStart(null);
              }}
              disabled={!doctor}
            >
              <option value="">{t('appointments.selectService')}</option>
              {doctor?.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.durationMinutes} {t('common.minutes')}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {doctorId && (
          <div>
            <p className="label">{t('appointments.pickSlot')}</p>
            <SlotPicker doctorId={doctorId} serviceId={serviceId || undefined} value={start} onChange={(s) => setStart(s.start)} />
          </div>
        )}
        <fieldset className="rounded-2xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-ink">{t('growth.appt.repeat')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('growth.appt.repeat')}>
              <Select
                value={frequency}
                onChange={(e) => {
                  setFrequency(e.target.value as Frequency | '');
                  setSeriesError(null);
                }}
              >
                <option value="">{t('growth.appt.repeatNone')}</option>
                <option value="WEEKLY">{t('growth.appt.freq.WEEKLY')}</option>
                <option value="BIWEEKLY">{t('growth.appt.freq.BIWEEKLY')}</option>
                <option value="MONTHLY">{t('growth.appt.freq.MONTHLY')}</option>
              </Select>
            </Field>
            {frequency && (
              <Field label={t('growth.appt.occurrences')} hint={t('growth.appt.occurrencesHint')}>
                <Input type="number" inputMode="numeric" min={2} max={24} value={occurrences} onChange={(e) => setOccurrences(Number(e.target.value))} onBlur={() => setOccurrences(occ)} />
              </Field>
            )}
          </div>
          {seriesError && (
            <div role="alert" className="mt-4 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-danger">
                <HiOutlineExclamationTriangle aria-hidden="true" />
                {t('growth.appt.seriesNoneBooked')}
              </p>
              {seriesError.length > 0 && skippedList(seriesError)}
            </div>
          )}
        </fieldset>
        <Field label={t('appointments.administrativeNotes')} hint={t('appointments.notesHint')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  );
}
