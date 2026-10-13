import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { HiOutlineArrowDownTray, HiOutlineArrowUpTray, HiOutlineCheckCircle, HiOutlineInformationCircle } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Field, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn, fmtNumber } from '@/lib/format';
import { downloadBlob } from './download';

export interface CsvImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: { row: number; error: string }[];
  dryRun: boolean;
}

export const MAX_CSV_CHARS = 2_000_000;
export const isPlanLimitError = (msg: string) => /plan|l[ií]mite|limit/i.test(msg);

/**
 * Two-step CSV import shared by patients and doctors: dry run (nothing saved) → review → import.
 */
export function CsvImportDialog({
  open,
  onClose,
  title,
  endpoint,
  headersHelp,
  note,
  template,
  templateName,
  invalidate,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  endpoint: string;
  headersHelp: string;
  note?: string;
  template: string;
  templateName: string;
  invalidate: string[];
}) {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const reset = () => {
    setCsv('');
    setFileName(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<CsvImportResult>(endpoint, { csv, dryRun }),
    onSuccess: (r) => {
      setResult({ ...r, errors: r.errors ?? [] });
      if (!r.dryRun) {
        toast.success(t('admin.import.imported', { count: r.created }));
        invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
      }
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_CSV_CHARS) {
      toast.error(t('admin.import.tooBig'));
      return;
    }
    setFileName(f.name);
    setResult(null);
    setCsv(await f.text());
  };

  const tooBig = csv.length > MAX_CSV_CHARS;
  const canRun = csv.trim().length > 0 && !tooBig;
  const done = result && !result.dryRun;

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="lg"
      footer={
        done ? (
          <>
            <Button variant="secondary" onClick={reset}>
              {t('admin.import.again')}
            </Button>
            <Button onClick={close}>{t('common.close')}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            {result?.dryRun ? (
              <Button loading={run.isPending} disabled={!canRun || result.created === 0} onClick={() => run.mutate(false)}>
                {t('admin.import.run')}
              </Button>
            ) : (
              <Button loading={run.isPending} disabled={!canRun} onClick={() => run.mutate(true)}>
                {t('admin.import.preview')}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        {!done && (
          <>
            <div className="rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm text-ink">
              <p className="flex items-center gap-1.5 font-semibold">
                <HiOutlineInformationCircle className="text-info" aria-hidden="true" /> {t('admin.import.headers')}
              </p>
              <p className="mt-1 break-words text-ink-2">{headersHelp}</p>
              <p className="mt-1 text-xs text-ink-3">{t('admin.import.separator')}</p>
              {note && <p className="mt-1 text-xs text-ink-3">{note}</p>}
              <Button variant="ghost" size="sm" className="mt-1 -ml-2" icon={<HiOutlineArrowDownTray aria-hidden="true" />} onClick={() => downloadBlob('\uFEFF' + template, templateName, 'text/csv;charset=utf-8')}>
                {t('admin.import.template')}
              </Button>
            </div>

            <div>
              <span className="label">{t('admin.import.file')}</span>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id={fileId}
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="sr-only"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <label htmlFor={fileId} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-2 focus-within:ring-2 focus-within:ring-primary">
                  <HiOutlineArrowUpTray aria-hidden="true" /> {t('admin.import.chooseFile')}
                </label>
                <span className="min-w-0 truncate text-sm text-ink-3">{fileName ?? t('admin.import.noFile')}</span>
              </div>
            </div>
            <Field label={t('admin.import.paste')} hint={t('admin.import.previewHint')} error={tooBig ? t('admin.import.tooBig') : undefined}>
              <Textarea
                rows={6}
                spellCheck={false}
                className="font-mono text-xs"
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setFileName(null);
                  setResult(null);
                }}
              />
            </Field>
          </>
        )}

        {result && (
          <section role="status" aria-live="polite" className="space-y-3">
            <p className={cn('flex items-start gap-2 rounded-xl px-3 py-2 text-sm', result.dryRun ? 'bg-warning-soft text-ink' : 'bg-success-soft text-ink')}>
              {!result.dryRun && <HiOutlineCheckCircle className="mt-0.5 shrink-0 text-success" aria-hidden="true" />}
              {result.dryRun ? t('admin.import.dryRunNote') : t('admin.import.doneNote')}
            </p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  [t('admin.import.total'), result.total, 'text-ink'],
                  [result.dryRun ? t('admin.import.willCreate') : t('admin.import.created'), result.created, 'text-success'],
                  [t('admin.import.skipped'), result.skipped, 'text-ink-2'],
                  [t('admin.import.errors'), result.errors.length, result.errors.length ? 'text-danger' : 'text-ink-2'],
                ] as const
              ).map(([label, value, cls]) => (
                <div key={label} className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className={cn('font-display text-xl font-bold tabular-nums', cls)}>{fmtNumber(value, prefs.lang)}</dd>
                </div>
              ))}
            </dl>
            {result.errors.length === 0 ? (
              <p className="text-sm text-ink-3">{t('admin.import.noErrors')}</p>
            ) : (
              <div className="scrollbar-thin max-h-60 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{t('admin.import.errors')}</caption>
                  <thead className="sticky top-0 bg-surface-2 text-xs text-ink-3">
                    <tr>
                      <th scope="col" className="w-16 px-3 py-2 font-medium">
                        {t('admin.import.row')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('admin.import.error')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={`${e.row}-${i}`} className="border-t border-border align-top">
                        <td className="px-3 py-2 tabular-nums">{e.row}</td>
                        <td className="break-words px-3 py-2 text-ink-2">
                          {isPlanLimitError(e.error) && (
                            <Badge tone="warning" className="mr-1.5">
                              {t('admin.import.planLimit')}
                            </Badge>
                          )}
                          {e.error}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
