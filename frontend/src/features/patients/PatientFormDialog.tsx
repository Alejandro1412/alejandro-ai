import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { Patient } from '@/types';
import type { PatientV3 } from './types';

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

export function PatientFormDialog({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: PatientV3; onSaved?: (p: Patient) => void }) {
  const t = useT();
  const { prefs } = usePreferences();
  const initialConsent = Boolean(patient?.consentAt);
  const initialMarketing = Boolean(patient?.marketingConsentAt);
  const [consent, setConsent] = useState(initialConsent);
  const [marketing, setMarketing] = useState(initialMarketing);
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
    if (open) {
      reset(defaults());
      setConsent(initialConsent);
      setMarketing(initialMarketing);
    }
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
        // Consent is only sent when it changes (edit) or when granted (create), so history stays meaningful.
        ...(patient ? (consent !== initialConsent ? { consent } : {}) : consent ? { consent: true } : {}),
        ...(patient ? (marketing !== initialMarketing ? { marketingConsent: marketing } : {}) : marketing ? { marketingConsent: true } : {}),
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
        <fieldset className="space-y-2.5 rounded-xl border border-border p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-semibold">{t('admin.privacy.title')}</legend>
          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--primary))]" aria-describedby="consent-hint" />
            <span>
              {t('admin.privacy.consentLabel')}
              <span id="consent-hint" className="block text-xs text-ink-3">
                {patient?.consentAt ? t('admin.privacy.consentSince', { date: fmtDate(patient.consentAt, prefs.lang) }) : t('admin.privacy.consentHint')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" checked={marketing} onChange={(ev) => setMarketing(ev.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--primary))]" />
            <span>{t('admin.privacy.marketingLabel')}</span>
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
