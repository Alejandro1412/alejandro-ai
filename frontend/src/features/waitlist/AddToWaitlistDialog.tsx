import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Display';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, ApiError, errorMessage } from '@/lib/api';
import { doctorName, fullName } from '@/lib/format';
import type { Doctor, Patient, Specialty } from '@/types';
import { addDays, dayRangeToIso, isoDay, type TimeOfDay } from './waitlist';

type Target = 'specialty' | 'doctor';

export function AddToWaitlistDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [target, setTarget] = useState<Target>('specialty');
  const [specialtyId, setSpecialtyId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [from, setFrom] = useState(() => isoDay(new Date()));
  const [to, setTo] = useState(() => isoDay(addDays(new Date(), 21)));
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | ''>('');
  const [notes, setNotes] = useState('');
  const [conflict, setConflict] = useState(false);

  const patients = useQuery({ queryKey: ['patients', 'picker', search], queryFn: () => api.page<Patient>('/patients', { search, pageSize: 20 }), enabled: open });
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api.get<Specialty[]>('/specialties'), enabled: open });
  const doctors = useQuery({ queryKey: ['doctors', 'active'], queryFn: () => api.get<Doctor[]>('/doctors', { status: 'ACTIVE' }), enabled: open });

  const range = dayRangeToIso(from, to);
  const targetId = target === 'specialty' ? specialtyId : doctorId;
  const valid = Boolean(patientId && targetId && range);

  const reset = () => {
    setSearch('');
    setPatientId('');
    setSpecialtyId('');
    setDoctorId('');
    setFrom(isoDay(new Date()));
    setTo(isoDay(addDays(new Date(), 21)));
    setTimeOfDay('');
    setNotes('');
    setConflict(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const create = useMutation({
    mutationFn: () =>
      api.post('/waitlist', {
        patientId,
        specialtyId: target === 'specialty' ? specialtyId : null,
        doctorId: target === 'doctor' ? doctorId : null,
        ...range,
        timeOfDay: timeOfDay || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('growth.waitlist.added'));
      void qc.invalidateQueries({ queryKey: ['waitlist'] });
      close();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ALREADY_ON_WAITLIST') setConflict(true);
      else toast.error(t('common.errorGeneric'), errorMessage(e));
    },
  });

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('growth.waitlist.add')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => create.mutate()} disabled={!valid} loading={create.isPending}>
            {t('growth.waitlist.add')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        {conflict && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-ink">
            <HiOutlineExclamationTriangle className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            {t('growth.waitlist.alreadyOn')}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('growth.waitlist.form.searchPatient')}>
            <Input type="search" placeholder={t('growth.waitlist.form.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label={t('growth.waitlist.form.patient')} required hint={patients.data && !patients.data.items.length ? t('growth.waitlist.form.noPatients') : undefined}>
            <Select
              value={patientId}
              onChange={(e) => {
                setPatientId(e.target.value);
                setConflict(false);
              }}
            >
              <option value="">{t('growth.waitlist.form.selectPatient')}</option>
              {patients.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {fullName(p)} {p.phone ? `· ${p.phone}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <p className="label">{t('growth.waitlist.form.targetType')}</p>
          <Segmented
            label={t('growth.waitlist.form.targetType')}
            value={target}
            onChange={(v) => {
              setTarget(v);
              setConflict(false);
            }}
            options={[
              { value: 'specialty', label: t('growth.waitlist.form.bySpecialty') },
              { value: 'doctor', label: t('growth.waitlist.form.byDoctor') },
            ]}
          />
        </div>
        {target === 'specialty' ? (
          <Field label={t('growth.waitlist.form.specialty')} required>
            <Select value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
              <option value="">{t('growth.waitlist.form.selectSpecialty')}</option>
              {specialties.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {prefs.lang === 'en' ? (s.nameEn ?? s.name) : s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('growth.waitlist.form.doctor')} required>
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">{t('growth.waitlist.form.selectDoctor')}</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {doctorName(d)}
                  {d.specialty ? ` · ${d.specialty.name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('growth.waitlist.form.from')} required>
            <Input type="date" value={from} min={isoDay(new Date())} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('growth.waitlist.form.to')} required error={from && to && !range ? t('growth.waitlist.form.invalidRange') : undefined}>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label={t('growth.waitlist.form.timeOfDay')}>
            <Select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value as TimeOfDay | '')}>
              <option value="">{t('growth.timeOfDay.any')}</option>
              <option value="morning">{t('growth.timeOfDay.morning')}</option>
              <option value="afternoon">{t('growth.timeOfDay.afternoon')}</option>
              <option value="evening">{t('growth.timeOfDay.evening')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('growth.waitlist.form.notes')} hint={t('growth.waitlist.form.notesHint')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      </form>
    </Modal>
  );
}
