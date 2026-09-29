import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import type { Patient } from '@/types';

export const patientFormSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.union([z.string().trim().email(), z.literal('')]),
  phone: z.union([z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/), z.literal('')]),
  documentId: z.string().trim().max(40),
  dateOfBirth: z.string(),
  gender: z.enum(['', 'F', 'M', 'X']),
  preferredLanguage: z.enum(['es', 'en']),
  tags: z.string(),
  notes: z.string().max(2000),
});
type Form = z.infer<typeof patientFormSchema>;

export function PatientFormDialog({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: Patient; onSaved?: (p: Patient) => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const defaults = (): Form => ({
    firstName: patient?.firstName ?? '',
    lastName: patient?.lastName ?? '',
    email: patient?.email ?? '',
    phone: patient?.phone ?? '',
    documentId: patient?.documentId ?? '',
    dateOfBirth: patient?.dateOfBirth ?? '',
    gender: (patient?.gender as Form['gender']) ?? '',
    preferredLanguage: (patient?.preferredLanguage as Form['preferredLanguage']) ?? 'es',
    tags: patient?.tags.join(', ') ?? '',
    notes: patient?.notes ?? '',
  });
  const { register, handleSubmit, reset, formState } = useForm<Form>({ resolver: zodResolver(patientFormSchema), defaultValues: defaults() });
  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient]);

  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = {
        ...v,
        email: v.email || null,
        phone: v.phone || null,
        documentId: v.documentId || null,
        dateOfBirth: v.dateOfBirth || null,
        gender: v.gender || null,
        notes: v.notes || null,
        tags: v.tags
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      };
      return patient ? api.patch<Patient>(`/patients/${patient.id}`, body) : api.post<Patient>('/patients', body);
    },
    onSuccess: (p) => {
      toast.success(t('patients.saved'));
      void qc.invalidateQueries({ queryKey: ['patients'] });
      onSaved?.(p);
      onClose();
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });
  const e = formState.errors;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={patient ? t('common.edit') : t('patients.new')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => ev.preventDefault()} noValidate>
        <Field label={t('patients.firstName')} error={e.firstName && t('common.required')} required>
          <Input autoComplete="off" {...register('firstName')} />
        </Field>
        <Field label={t('patients.lastName')} error={e.lastName && t('common.required')} required>
          <Input autoComplete="off" {...register('lastName')} />
        </Field>
        <Field label={t('common.phone')} error={e.phone && 'Formato: +57 300 123 4567'}>
          <Input type="tel" inputMode="tel" {...register('phone')} />
        </Field>
        <Field label={t('common.email')} error={e.email && t('common.required')}>
          <Input type="email" {...register('email')} />
        </Field>
        <Field label={t('patients.document')}>
          <Input {...register('documentId')} />
        </Field>
        <Field label={t('patients.birthDate')}>
          <Input type="date" {...register('dateOfBirth')} />
        </Field>
        <Field label={t('patients.gender')}>
          <Select {...register('gender')}>
            <option value="">—</option>
            {(['F', 'M', 'X'] as const).map((g) => (
              <option key={g} value={g}>
                {t(`patients.genders.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('patients.language')}>
          <Select {...register('preferredLanguage')}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label={t('patients.tags')} hint={t('patients.tagsHint')} className="sm:col-span-2">
          <Input {...register('tags')} />
        </Field>
        <Field label={t('appointments.administrativeNotes')} hint={t('appointments.notesHint')} className="sm:col-span-2">
          <Textarea rows={3} {...register('notes')} />
        </Field>
      </form>
    </Modal>
  );
}
