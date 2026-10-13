import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiChevronDown, HiChevronUp, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';
import type { Service, Specialty } from '@/types';
import { INTAKE_TYPES, MAX_INTAKE_FIELDS, keyFromLabel, moneyToCents, moveItem, newDraft, toDrafts, toIntakeFields, validateIntake, type IntakeDraft, type IntakeError, type IntakeField } from './intakeFields';

export type ServiceV3 = Service & { depositCents?: number | null; isVirtual?: boolean; intakeFields?: IntakeField[] };

const centsToInput = (c: number | null | undefined) => (c === null || c === undefined ? '' : String(c / 100));

export function ServiceDialog({
  open,
  onClose,
  service,
  specialties,
  currency,
  depositsEnabled,
}: {
  open: boolean;
  onClose: () => void;
  service?: ServiceV3 | null;
  specialties: Specialty[];
  currency: string;
  depositsEnabled: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', nameEn: '', specialtyId: '', durationMinutes: 30, price: '', deposit: '', isVirtual: false });
  const [fields, setFields] = useState<IntakeDraft[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF({
      name: service?.name ?? '',
      nameEn: service?.nameEn ?? '',
      specialtyId: service?.specialtyId ?? '',
      durationMinutes: service?.durationMinutes ?? 30,
      price: centsToInput(service?.priceCents),
      deposit: centsToInput(service?.depositCents),
      isVirtual: Boolean(service?.isVirtual),
    });
    setFields(toDrafts(service?.intakeFields));
    setShowErrors(false);
  }, [open, service]);

  const fieldErrors = validateIntake(fields);
  const priceCents = moneyToCents(f.price);
  const depositCents = moneyToCents(f.deposit);
  const badMoney = (c: number | null) => c !== null && (Number.isNaN(c) || c > 100_000_000);
  const valid = f.name.trim().length >= 2 && f.durationMinutes >= 5 && f.durationMinutes <= 480 && !badMoney(priceCents) && !badMoney(depositCents) && !Object.keys(fieldErrors).length;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        nameEn: f.nameEn.trim() || null,
        specialtyId: f.specialtyId || null,
        durationMinutes: Number(f.durationMinutes),
        priceCents,
        currency: service?.currency ?? currency,
        depositCents: depositCents || null,
        isVirtual: f.isVirtual,
        intakeFields: toIntakeFields(fields),
      };
      return service ? api.patch(`/services/${service.id}`, body) : api.post('/services', body);
    },
    onSuccess: () => {
      toast.success(t('admin.service.saved'));
      void qc.invalidateQueries({ queryKey: ['services'] });
      onClose();
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const update = (id: string, patch: Partial<IntakeDraft>) =>
    setFields((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, ...patch };
        if (patch.label !== undefined && !x.keyEdited) next.key = keyFromLabel(patch.label);
        return next;
      }),
    );
  const errText: Record<IntakeError, string> = { label: t('admin.service.errLabel'), key: t('admin.service.errKey'), keyDup: t('admin.service.errKeyDup'), options: t('admin.service.errOptions') };
  const errFor = (d: IntakeDraft, kinds: IntakeError[]) => (showErrors || d.label ? fieldErrors[d.id]?.filter((e) => kinds.includes(e)).map((e) => errText[e])[0] : undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={service ? t('admin.service.editNamed', { name: service.name }) : t('admin.service.create')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!valid) {
                setShowErrors(true);
                toast.error(t('admin.service.fixErrors'));
                return;
              }
              save.mutate();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('common.name')} required error={showErrors && f.name.trim().length < 2 ? t('common.required') : undefined}>
            <Input value={f.name} maxLength={160} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t('admin.service.englishName')}>
            <Input value={f.nameEn} maxLength={160} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          </Field>
          <Field label={t('doctors.specialty')}>
            <Select value={f.specialtyId} onChange={(e) => setF({ ...f, specialtyId: e.target.value })}>
              <option value="">—</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.duration')}>
            <Input type="number" min={5} max={480} step={5} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} />
          </Field>
          <Field label={`${t('common.price')} (${service?.currency ?? currency})`} hint={t('common.priceOnRequest')} error={badMoney(priceCents) ? t('admin.service.errDeposit') : undefined}>
            <Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field
            label={`${t('admin.service.deposit')} (${service?.currency ?? currency})`}
            hint={depositsEnabled ? t('admin.service.depositHint', { currency: service?.currency ?? currency }) : t('admin.service.depositsOff')}
            error={badMoney(depositCents) ? t('admin.service.errDeposit') : undefined}
          >
            <Input inputMode="decimal" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} />
          </Field>
        </div>
        <Switch checked={f.isVirtual} onChange={(v) => setF({ ...f, isVirtual: v })} label={t('admin.service.virtual')} description={t('admin.service.virtualHint')} />

        <fieldset className="space-y-3 rounded-2xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{t('admin.service.intake')}</legend>
          <p className="text-xs text-ink-3">{t('admin.service.intakeHint')}</p>
          {!fields.length && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-3">{t('admin.service.intakeEmpty')}</p>}
          <ol className="space-y-3">
            {fields.map((d, i) => {
              const n = i + 1;
              return (
                <li key={d.id} className={cn('rounded-xl border p-3', fieldErrors[d.id] && (showErrors || d.label) ? 'border-danger/50' : 'border-border')}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t('admin.service.fieldN', { n })}</span>
                    <div className="flex gap-0.5">
                      <button type="button" disabled={i === 0} onClick={() => setFields((xs) => moveItem(xs, i, i - 1))} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40" aria-label={t('admin.service.moveUp', { n })}>
                        <HiChevronUp aria-hidden="true" />
                      </button>
                      <button type="button" disabled={i === fields.length - 1} onClick={() => setFields((xs) => moveItem(xs, i, i + 1))} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40" aria-label={t('admin.service.moveDown', { n })}>
                        <HiChevronDown aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => setFields((xs) => xs.filter((x) => x.id !== d.id))} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={t('admin.service.removeField', { n })}>
                        <HiOutlineTrash aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t('admin.service.fieldLabel')} required error={errFor(d, ['label'])} className="sm:col-span-2">
                      <Input value={d.label} maxLength={160} onChange={(e) => update(d.id, { label: e.target.value })} />
                    </Field>
                    <Field label={t('admin.service.fieldKey')} hint={t('admin.service.fieldKeyHint')} error={errFor(d, ['key', 'keyDup'])}>
                      <Input value={d.key} maxLength={40} className="font-mono text-sm" autoComplete="off" spellCheck={false} onChange={(e) => update(d.id, { key: e.target.value.trim(), keyEdited: true })} />
                    </Field>
                    <Field label={t('admin.service.fieldType')}>
                      <Select value={d.type} onChange={(e) => update(d.id, { type: e.target.value as IntakeDraft['type'] })}>
                        {INTAKE_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {t(`admin.service.types.${ty}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {d.type === 'select' && (
                      <Field label={t('admin.service.fieldOptions')} hint={t('admin.service.fieldOptionsHint')} error={errFor(d, ['options'])} className="sm:col-span-2">
                        <Input value={d.optionsText} onChange={(e) => update(d.id, { optionsText: e.target.value })} />
                      </Field>
                    )}
                    <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
                      <input type="checkbox" checked={d.required} onChange={(e) => update(d.id, { required: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--primary))]" />
                      {t('admin.service.fieldRequired')}
                    </label>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" icon={<HiPlus aria-hidden="true" />} disabled={fields.length >= MAX_INTAKE_FIELDS} onClick={() => setFields((xs) => [...xs, newDraft()])}>
              {t('admin.service.addField')}
            </Button>
            <span className="text-xs text-ink-3" aria-live="polite">
              {fields.length}/{MAX_INTAKE_FIELDS}
              {fields.length >= MAX_INTAKE_FIELDS && ` · ${t('admin.service.errMax')}`}
            </span>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
