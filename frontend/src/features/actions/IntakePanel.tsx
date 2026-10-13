import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { HiOutlineClipboardDocumentCheck, HiOutlinePencilSquare } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useT, type TKey } from '@/contexts/PreferencesContext';
import { api, ApiError } from '@/lib/api';
import { actionKey } from './AppointmentPanels';
import { initialIntakeValues, normalizeIntake, validateIntake, type IntakeError } from './helpers';
import { InlineError, Notice, PanelHeading, ResultState, useWhen } from './parts';
import type { IntakeAnswers, IntakeField, PanelProps } from './types';

const errKey: Record<IntakeError, TKey> = {
  required: 'pub.intake.required',
  invalidOption: 'pub.intake.invalidOption',
  invalidDate: 'pub.intake.invalidDate',
};

export function IntakePanel({ token, info }: PanelProps) {
  const t = useT();
  const when = useWhen();
  const qc = useQueryClient();
  const fields = info.fields ?? [];
  const appt = info.appointment;
  const hadAnswers = Boolean(info.answers && Object.keys(info.answers).length);
  const [values, setValues] = useState<IntakeAnswers>(() => initialIntakeValues(fields, info.answers));
  const [errors, setErrors] = useState<Record<string, IntakeError>>({});
  const [editing, setEditing] = useState(true);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const save = useMutation({
    mutationFn: (answers: IntakeAnswers) => api.post<{ saved: boolean }>(`/public/actions/${encodeURIComponent(token)}`, { answers }, { anonymous: true }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: actionKey(token) });
    },
    onError: (err) => {
      const field = err instanceof ApiError && err.status === 400 ? (err.details as { field?: unknown }).field : undefined;
      if (typeof field === 'string' && fields.some((f) => f.key === field)) {
        const local = validateIntake(fields, values)[field];
        setErrors({ [field]: local ?? 'required' });
        setFocusTick((n) => n + 1);
      }
    },
  });

  // Move focus to the first invalid control after a failed submit (client or server side).
  useEffect(() => {
    if (focusTick) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const code = save.error instanceof ApiError ? save.error.code : null;
  if (!fields.length || code === 'NO_INTAKE_FORM') return <ResultState tone="info" title={t('pub.intake.empty')} />;
  if (code === 'INTAKE_CLOSED') return <ResultState tone="warning" title={t('pub.intake.closed')} />;

  if (!editing)
    return (
      <ResultState tone="success" icon={<HiOutlineClipboardDocumentCheck />} title={t('pub.intake.doneTitle')} body={t('pub.intake.doneBody')}>
        <Button variant="secondary" size="lg" className="w-full" icon={<HiOutlinePencilSquare aria-hidden="true" />} onClick={() => setEditing(true)}>
          {t('pub.intake.editAgain')}
        </Button>
      </ResultState>
    );

  const set = (key: string, v: string | boolean) => {
    setValues((s) => ({ ...s, [key]: v }));
    if (errors[key])
      setErrors((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateIntake(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFocusTick((n) => n + 1);
      return;
    }
    save.mutate(normalizeIntake(fields, values));
  };

  const hasErrors = Object.keys(errors).length > 0;
  const isUpdate = hadAnswers || save.isSuccess;
  return (
    <div>
      <PanelHeading title={t('pub.intake.title')} subtitle={t('pub.intake.subtitle', { clinic: info.clinic.name })} />
      {appt && (
        <p className="-mt-2 mb-5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
          <span className="cap-first font-medium text-ink">{when(appt.start, info.clinic.timezone, appt.when)}</span> · {appt.doctor}
        </p>
      )}
      {isUpdate && (
        <div className="mb-4">
          <Notice tone="info">{t('pub.intake.previously')}</Notice>
        </div>
      )}
      <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
        <p className="text-xs text-ink-3">{t('pub.intake.requiredNote')}</p>
        {fields.map((f) => (
          <IntakeControl key={f.key} field={f} value={values[f.key]} error={errors[f.key] ? t(errKey[errors[f.key]]) : undefined} onChange={(v) => set(f.key, v)} disabled={save.isPending} />
        ))}
        {hasErrors && (
          <p role="alert" className="text-sm font-medium text-danger">
            {t('pub.intake.fixErrors')}
          </p>
        )}
        {save.isError && !(save.error instanceof ApiError && save.error.status === 400) && <InlineError error={save.error} clinic={info.clinic} />}
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>
          {isUpdate ? t('pub.intake.update') : t('pub.intake.submit')}
        </Button>
      </form>
    </div>
  );
}

function IntakeControl({ field: f, value, error, onChange, disabled }: { field: IntakeField; value: string | boolean | undefined; error?: string; onChange: (v: string | boolean) => void; disabled?: boolean }) {
  const t = useT();
  const id = useId();
  if (f.type === 'checkbox') {
    const errId = `${id}-err`;
    return (
      <div>
        <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 has-[:focus-visible]:border-primary">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            aria-required={f.required || undefined}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong accent-[rgb(var(--primary))]"
          />
          <span className="text-sm text-ink">
            {f.label}
            {f.required && (
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            )}
          </span>
        </label>
        {error && (
          <p id={errId} role="alert" className="mt-1.5 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  const str = typeof value === 'string' ? value : '';
  return (
    <Field label={f.label} required={f.required} error={error}>
      {f.type === 'textarea' ? (
        <Textarea value={str} maxLength={2000} rows={4} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      ) : f.type === 'select' ? (
        <Select value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{t('pub.intake.choose')}</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : (
        <Input type={f.type === 'date' ? 'date' : 'text'} value={str} maxLength={2000} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      )}
    </Field>
  );
}
