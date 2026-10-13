import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlinePencilSquare, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import type { Clinic, Location, Specialty } from '@/types';
import { ClinicPrivacyCard, type ClinicV3 } from './ClinicPrivacyCard';
import { ServiceDialog, type ServiceV3 } from './ServiceDialog';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const TIMEZONES = ['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'UTC'];

export default function ClinicSettings() {
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const editable = can('settings.manage');
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => api.get<ClinicV3>('/clinics/current') });
  const [form, setForm] = useState<Partial<Clinic>>({});
  useEffect(() => {
    if (clinic.data) setForm(clinic.data);
  }, [clinic.data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch('/clinics/current', {
        name: form.name,
        description: form.description || null,
        timezone: form.timezone,
        currency: form.currency,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        address: form.address || null,
        city: form.city || null,
        country: form.country || null,
        businessHours: form.businessHours,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['clinic'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  if (clinic.isLoading || !form.id) return <Skeleton className="h-96 rounded-2xl" />;
  const set = (k: keyof Clinic) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const hours = form.businessHours ?? {};

  return (
    <>
      <Card>
        <CardHeader title={t('settings.clinicInfo')} />
        <fieldset disabled={!editable} className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label={t('common.name')} required>
            <Input value={form.name ?? ''} onChange={set('name')} />
          </Field>
          <Field label={t('settings.website')}>
            <Input type="url" value={form.website ?? ''} onChange={set('website')} />
          </Field>
          <Field label={t('common.phone')}>
            <Input type="tel" value={form.phone ?? ''} onChange={set('phone')} />
          </Field>
          <Field label={t('common.email')}>
            <Input type="email" value={form.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label={t('settings.address')}>
            <Input value={form.address ?? ''} onChange={set('address')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('settings.city')}>
              <Input value={form.city ?? ''} onChange={set('city')} />
            </Field>
            <Field label={t('settings.country')}>
              <Input value={form.country ?? ''} onChange={set('country')} />
            </Field>
          </div>
          <Field label={t('settings.timezone')}>
            <Select value={form.timezone} onChange={set('timezone')}>
              {[...new Set([form.timezone!, ...TIMEZONES])].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.currency')}>
            <Select value={form.currency} onChange={set('currency')}>
              {['COP', 'USD', 'MXN', 'EUR', 'PEN', 'CLP', 'ARS'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.description')} className="sm:col-span-2">
            <Textarea rows={3} value={form.description ?? ''} onChange={set('description')} />
          </Field>
        </fieldset>
        <CardHeader title={t('settings.businessHours')} />
        <fieldset disabled={!editable} className="space-y-2 px-5 pb-5">
          <legend className="sr-only">{t('settings.businessHours')}</legend>
          {DAYS.map((d, idx) => {
            const iv = hours[d]?.[0];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3">
                <label className="flex w-36 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={Boolean(iv)}
                    onChange={(e) => setForm((f) => ({ ...f, businessHours: { ...f.businessHours, [d]: e.target.checked ? [['08:00', '18:00']] : [] } }))}
                    className="h-4 w-4 accent-[rgb(var(--primary))]"
                  />
                  {t(`days.${idx + 1}` as never)}
                </label>
                {iv ? (
                  <span className="flex items-center gap-1.5">
                    <input type="time" aria-label={`${d} open`} value={iv[0]} onChange={(e) => setForm((f) => ({ ...f, businessHours: { ...f.businessHours, [d]: [[e.target.value, iv[1]]] } }))} className="input w-32 py-1.5" />
                    –
                    <input type="time" aria-label={`${d} close`} value={iv[1]} onChange={(e) => setForm((f) => ({ ...f, businessHours: { ...f.businessHours, [d]: [[iv[0], e.target.value]] } }))} className="input w-32 py-1.5" />
                  </span>
                ) : (
                  <span className="text-sm text-ink-3">{t('doctors.closed')}</span>
                )}
              </div>
            );
          })}
        </fieldset>
        {editable && (
          <div className="flex justify-end border-t border-border p-4">
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Card>
      {clinic.data && <ClinicPrivacyCard clinic={clinic.data} editable={editable} />}
      <LocationsCard editable={editable} />
      <CatalogCard editable={can('services.write')} lang={prefs.lang} currency={clinic.data?.currency ?? 'COP'} depositsEnabled={Boolean(clinic.data?.depositsEnabled)} />
    </>
  );
}

function LocationsCard({ editable }: { editable: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', address: '', city: '', phone: '' });
  const q = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/locations') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['locations'] });
  const create = useMutation({
    mutationFn: () => api.post('/locations', { ...f, city: f.city || null, phone: f.phone || null }),
    onSuccess: () => {
      setOpen(false);
      setF({ name: '', address: '', city: '', phone: '' });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/locations/${id}`), onSuccess: refresh });
  return (
    <Card>
      <CardHeader
        title={t('settings.locations')}
        action={
          editable && (
            <Button size="sm" variant="ghost" icon={<HiPlus aria-hidden="true" />} onClick={() => setOpen(true)}>
              {t('settings.addLocation')}
            </Button>
          )
        }
      />
      <ul className="divide-y divide-border px-5 pb-3">
        {q.data?.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{l.name}</span>
              <span className="block text-ink-3">
                {l.address}
                {l.city ? `, ${l.city}` : ''} {l.phone ? `· ${l.phone}` : ''}
              </span>
            </span>
            {editable && (
              <button type="button" onClick={() => remove.mutate(l.id)} className="rounded-lg p-2 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`${t('common.delete')} ${l.name}`}>
                <HiOutlineTrash aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('settings.addLocation')}
        size="sm"
        footer={
          <Button loading={create.isPending} disabled={f.name.length < 2 || f.address.length < 3} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label={t('common.name')} required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t('settings.address')} required>
            <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </Field>
          <Field label={t('settings.city')}>
            <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </Field>
          <Field label={t('common.phone')}>
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

function CatalogCard({ editable, lang, currency, depositsEnabled }: { editable: boolean; lang: 'es' | 'en'; currency: string; depositsEnabled: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api.get<Specialty[]>('/specialties') });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get<ServiceV3[]>('/services') });
  const [spOpen, setSpOpen] = useState(false);
  const [svOpen, setSvOpen] = useState(false);
  const [svEdit, setSvEdit] = useState<ServiceV3 | null>(null);
  const [sp, setSp] = useState({ name: '', nameEn: '', keywords: '' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['specialties'] });
    void qc.invalidateQueries({ queryKey: ['services'] });
  };
  const createSp = useMutation({
    mutationFn: () => api.post('/specialties', { name: sp.name, nameEn: sp.nameEn || null, keywords: sp.keywords.split(',').map((k) => k.trim()).filter(Boolean) }),
    onSuccess: () => {
      setSpOpen(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeSv = useMutation({ mutationFn: (id: string) => api.delete(`/services/${id}`), onSuccess: refresh });

  return (
    <Card>
      <CardHeader
        title={t('settings.specialtiesServices')}
        action={
          editable && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<HiPlus aria-hidden="true" />} onClick={() => setSpOpen(true)}>
                {t('settings.addSpecialty')}
              </Button>
              <Button size="sm" variant="ghost" icon={<HiPlus aria-hidden="true" />} onClick={() => {
                  setSvEdit(null);
                  setSvOpen(true);
                }}>
                {t('settings.addService')}
              </Button>
            </div>
          )
        }
      />
      <div className="space-y-5 px-5 pb-5">
        {[...(specialties.data ?? []), ...(services.data?.some((x) => !x.specialtyId) ? [{ id: '', name: '—', nameEn: null, keywords: [] as string[] }] : [])].map((s) => (
          <section key={s.id || 'none'} aria-label={s.name}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{s.name}</h3>
              {s.nameEn && <Badge>{s.nameEn}</Badge>}
              <span className="text-xs text-ink-3">{s.keywords.slice(0, 6).join(', ')}</span>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {services.data
                ?.filter((x) => (x.specialtyId ?? '') === s.id)
                .map((x) => (
                  <li key={x.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{x.name}</span>
                      {(x.isVirtual || Boolean(x.depositCents) || Boolean(x.intakeFields?.length)) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {x.isVirtual && <Badge tone="info">{t('admin.service.badgeVirtual')}</Badge>}
                          {Boolean(x.depositCents) && <Badge tone="warning">{t('admin.service.badgeDeposit', { amount: fmtMoney(x.depositCents ?? 0, x.currency, lang) ?? '' })}</Badge>}
                          {Boolean(x.intakeFields?.length) && <Badge>{t('admin.service.badgeIntake', { count: x.intakeFields?.length ?? 0 })}</Badge>}
                        </span>
                      )}
                    </span>
                    <span className="hidden text-ink-3 sm:inline">
                      {x.durationMinutes} {t('common.minutes')}
                    </span>
                    <span className="text-right font-medium sm:w-28">{fmtMoney(x.priceCents, x.currency, lang) ?? t('common.priceOnRequest')}</span>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => {
                          setSvEdit(x);
                          setSvOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
                        aria-label={t('admin.service.editNamed', { name: x.name })}
                      >
                        <HiOutlinePencilSquare aria-hidden="true" />
                      </button>
                    )}
                    {editable && (
                      <button type="button" onClick={() => removeSv.mutate(x.id)} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`${t('common.delete')} ${x.name}`}>
                        <HiOutlineTrash aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <Modal open={spOpen} onClose={() => setSpOpen(false)} title={t('settings.addSpecialty')} size="sm" footer={<Button disabled={sp.name.length < 2} loading={createSp.isPending} onClick={() => createSp.mutate()}>{t('common.save')}</Button>}>
        <div className="space-y-4">
          <Field label={t('common.name')} required>
            <Input value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} />
          </Field>
          <Field label="English name">
            <Input value={sp.nameEn} onChange={(e) => setSp({ ...sp, nameEn: e.target.value })} />
          </Field>
          <Field label={t('settings.keywords')} hint={t('patients.tagsHint')}>
            <Input value={sp.keywords} onChange={(e) => setSp({ ...sp, keywords: e.target.value })} />
          </Field>
        </div>
      </Modal>
      <ServiceDialog open={svOpen} onClose={() => setSvOpen(false)} service={svEdit} specialties={specialties.data ?? []} currency={currency} depositsEnabled={depositsEnabled} />
    </Card>
  );
}
