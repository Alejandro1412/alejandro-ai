import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { doctorName, fullName } from '@/lib/format';
import type { Appointment, Doctor, Patient } from '@/types';
import { SlotPicker } from './SlotPicker';

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('appointments.new')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => create.mutate()} disabled={!patientId || !doctorId || !start} loading={create.isPending}>
            {t('common.create')}
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
        <Field label={t('appointments.administrativeNotes')} hint={t('appointments.notesHint')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  );
}
