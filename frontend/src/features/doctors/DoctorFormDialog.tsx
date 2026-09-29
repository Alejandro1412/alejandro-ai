import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import type { Doctor, Location, Service, Specialty } from '@/types';

export const doctorFormSchema = z.object({
  title: z.enum(['Dr.', 'Dra.', 'Lic.', 'Psic.', 'Nut.', 'Ft.']),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.union([z.string().trim().email(), z.literal('')]),
  phone: z.string().trim().max(30),
  bio: z.string().trim().max(2000),
  specialtyId: z.string(),
  locationId: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']),
  defaultDurationMinutes: z.coerce.number().int().min(5).max(480),
  bufferMinutes: z.coerce.number().int().min(0).max(120),
  languages: z.array(z.enum(['es', 'en', 'pt', 'fr'])).min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  serviceIds: z.array(z.string()),
});
type Form = z.input<typeof doctorFormSchema>;

export function DoctorFormDialog({ open, onClose, doctor }: { open: boolean; onClose: () => void; doctor?: Doctor }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api.get<Specialty[]>('/specialties'), enabled: open });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/locations'), enabled: open });

  const defaults = (): Form => ({
    title: (doctor?.title as Form['title']) ?? 'Dr.',
    firstName: doctor?.firstName ?? '',
    lastName: doctor?.lastName ?? '',
    email: doctor?.email ?? '',
    phone: doctor?.phone ?? '',
    bio: doctor?.bio ?? '',
    specialtyId: doctor?.specialtyId ?? '',
    locationId: doctor?.locationId ?? '',
    status: doctor?.status ?? 'ACTIVE',
    defaultDurationMinutes: doctor?.defaultDurationMinutes ?? 30,
    bufferMinutes: doctor?.bufferMinutes ?? 0,
    languages: (doctor?.languages as Form['languages']) ?? ['es'],
    color: doctor?.color ?? '#4f46e5',
    serviceIds: doctor?.services.map((s) => s.id) ?? [],
  });
  const { register, handleSubmit, control, reset, watch, formState } = useForm<Form>({ resolver: zodResolver(doctorFormSchema), defaultValues: defaults() });
  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doctor]);
  const specialtyId = watch('specialtyId');

  const save = useMutation({
    mutationFn: (v: z.output<typeof doctorFormSchema>) => {
      const body = { ...v, email: v.email || null, phone: v.phone || null, bio: v.bio || null, specialtyId: v.specialtyId || null, locationId: v.locationId || null };
      return doctor ? api.patch<Doctor>(`/doctors/${doctor.id}`, body) : api.post<Doctor>('/doctors', body);
    },
    onSuccess: () => {
      toast.success(t('doctors.saved'));
      void qc.invalidateQueries({ queryKey: ['doctors'] });
      onClose();
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });
  const e = formState.errors;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={doctor ? t('common.edit') : t('doctors.new')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v as z.output<typeof doctorFormSchema>))}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-6" onSubmit={(ev) => ev.preventDefault()} noValidate>
        <Field label={t('doctors.title2')} className="sm:col-span-2">
          <Select {...register('title')}>
            {['Dr.', 'Dra.', 'Lic.', 'Psic.', 'Nut.', 'Ft.'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('doctors.firstName')} error={e.firstName && t('common.required')} required className="sm:col-span-2">
          <Input {...register('firstName')} />
        </Field>
        <Field label={t('doctors.lastName')} error={e.lastName && t('common.required')} required className="sm:col-span-2">
          <Input {...register('lastName')} />
        </Field>
        <Field label={t('doctors.specialty')} className="sm:col-span-3">
          <Select {...register('specialtyId')}>
            <option value="">—</option>
            {specialties.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('doctors.location')} className="sm:col-span-3">
          <Select {...register('locationId')}>
            <option value="">—</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.email')} error={e.email && t('common.required')} className="sm:col-span-3">
          <Input type="email" {...register('email')} />
        </Field>
        <Field label={t('common.phone')} className="sm:col-span-3">
          <Input type="tel" {...register('phone')} />
        </Field>
        <Field label={t('doctors.duration')} className="sm:col-span-2">
          <Input type="number" min={5} step={5} {...register('defaultDurationMinutes')} />
        </Field>
        <Field label={t('doctors.buffer')} className="sm:col-span-2">
          <Input type="number" min={0} step={5} {...register('bufferMinutes')} />
        </Field>
        <Field label={t('common.status')} className="sm:col-span-2">
          <Select {...register('status')}>
            {(['ACTIVE', 'INACTIVE', 'ON_LEAVE'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`doctorStatus.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('doctors.color')} className="sm:col-span-2">
          <Input type="color" className="h-11 p-1" {...register('color')} />
        </Field>
        <fieldset className="sm:col-span-4">
          <legend className="label">{t('doctors.languages')}</legend>
          <Controller
            control={control}
            name="languages"
            render={({ field }) => (
              <div className="flex flex-wrap gap-4 pt-2">
                {(['es', 'en', 'pt', 'fr'] as const).map((l) => (
                  <Checkbox key={l} label={l.toUpperCase()} checked={field.value.includes(l)} onChange={(v) => field.onChange(v ? [...field.value, l] : field.value.filter((x) => x !== l))} />
                ))}
              </div>
            )}
          />
        </fieldset>
        <fieldset className="sm:col-span-6">
          <legend className="label">{t('doctors.services')}</legend>
          <Controller
            control={control}
            name="serviceIds"
            render={({ field }) => (
              <div className="grid gap-2 pt-1 sm:grid-cols-2">
                {services.data
                  ?.filter((s) => !specialtyId || s.specialtyId === specialtyId)
                  .map((s) => (
                    <Checkbox key={s.id} label={s.name} checked={field.value.includes(s.id)} onChange={(v) => field.onChange(v ? [...field.value, s.id] : field.value.filter((x) => x !== s.id))} />
                  ))}
              </div>
            )}
          />
        </fieldset>
        <Field label={t('doctors.bio')} className="sm:col-span-6">
          <Textarea rows={3} {...register('bio')} />
        </Field>
      </form>
    </Modal>
  );
}
