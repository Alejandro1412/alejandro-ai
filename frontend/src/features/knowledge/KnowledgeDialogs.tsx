import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { HiOutlineArrowUpTray, HiOutlineCheckCircle, HiOutlineGlobeAlt, HiOutlineMinusCircle, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn, fmtNumber } from '@/lib/format';

export type KbDialog = 'upload' | 'text' | 'faq' | 'url' | 'website' | null;

export function KnowledgeDialogs({ open, onClose }: { open: KbDialog; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [faq, setFaq] = useState([{ question: '', answer: '' }]);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetAll = () => {
    setFile(null);
    setTitle('');
    setCategory('');
    setText('');
    setUrl('');
    setFaq([{ question: '', answer: '' }]);
  };
  const close = () => {
    resetAll();
    onClose();
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (open === 'upload') {
        const fd = new FormData();
        fd.append('file', file!);
        if (title) fd.append('title', title);
        if (category) fd.append('category', category);
        return api.upload('/knowledge/documents', fd);
      }
      if (open === 'text') return api.post('/knowledge/text', { title, text, category: category || undefined });
      if (open === 'url') return api.post('/knowledge/url', { url, title: title || undefined, category: category || undefined });
      return api.post('/knowledge/faq', { title, category: category || undefined, items: faq.filter((f) => f.question && f.answer) });
    },
    onSuccess: () => {
      toast.success(t('knowledge.uploaded'));
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
      close();
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const valid =
    open === 'upload' ? Boolean(file) : open === 'text' ? title.length >= 2 && text.length >= 10 : open === 'url' ? /^https?:\/\//.test(url) : title.length >= 2 && faq.some((f) => f.question.length >= 3 && f.answer);

  const titles = { upload: t('knowledge.upload'), text: t('knowledge.addText'), faq: t('knowledge.addFaq'), url: t('knowledge.addUrl'), website: t('admin.website.title') };

  return (
    <>
      <WebsiteImportDialog open={open === 'website'} onClose={onClose} />
      <Modal
        open={open !== null && open !== 'website'}
        onClose={close}
        title={open ? titles[open] : ''}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!valid} loading={submit.isPending} onClick={() => submit.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {open === 'upload' && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              className={cn('flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition', drag ? 'border-primary bg-primary-soft' : 'border-border-strong hover:border-primary')}
            >
              <HiOutlineArrowUpTray className="text-3xl text-primary" aria-hidden="true" />
              <span className="mt-3 text-sm font-semibold">{file ? file.name : t('knowledge.dropHere')}</span>
              <span className="mt-1 text-xs text-ink-3">{t('knowledge.fileTypes')}</span>
              <input ref={inputRef} type="file" className="sr-only" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </button>
          )}
          {open === 'url' && (
            <Field label={t('knowledge.url')} required>
              <Input type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('knowledge.titleField')} required={open === 'text' || open === 'faq'}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t('knowledge.category')}>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="politicas, servicios, faq…" />
            </Field>
          </div>
          {open === 'text' && (
            <Field label={t('knowledge.content')} required>
              <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
          {open === 'faq' && (
            <div className="space-y-3">
              {faq.map((f, i) => (
                <fieldset key={i} className="space-y-2 rounded-2xl border border-border p-3">
                  <legend className="sr-only">
                    {t('knowledge.question')} {i + 1}
                  </legend>
                  <div className="flex items-start gap-2">
                    <Field label={`${t('knowledge.question')} ${i + 1}`} className="flex-1">
                      <Input value={f.question} onChange={(e) => setFaq((x) => x.map((y, j) => (j === i ? { ...y, question: e.target.value } : y)))} />
                    </Field>
                    {faq.length > 1 && (
                      <button type="button" className="mt-7 rounded-lg p-2 text-ink-3 hover:bg-danger-soft hover:text-danger" onClick={() => setFaq((x) => x.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                        <HiOutlineTrash aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <Field label={t('knowledge.answer')}>
                    <Textarea rows={2} value={f.answer} onChange={(e) => setFaq((x) => x.map((y, j) => (j === i ? { ...y, answer: e.target.value } : y)))} />
                  </Field>
                </fieldset>
              ))}
              <Button variant="ghost" size="sm" icon={<HiPlus aria-hidden="true" />} onClick={() => setFaq((x) => [...x, { question: '', answer: '' }])}>
                {t('knowledge.addQuestion')}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

interface WebsiteImportResult {
  site: string;
  created: { id: string; url: string }[];
  skipped: { url: string; reason: string }[];
  discovered: number;
}

/** Crawl a public website (same site only, up to 15 pages); pages are indexed in the background. */
function WebsiteImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(8);
  const [result, setResult] = useState<WebsiteImportResult | null>(null);
  const close = () => {
    setUrl('');
    setMaxPages(8);
    setResult(null);
    onClose();
  };
  const run = useMutation({
    mutationFn: () => api.post<WebsiteImportResult>('/knowledge/website', { url: url.trim(), maxPages }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(t('admin.website.done', { count: r.created.length }));
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });
  const valid = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url.trim());

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('admin.website.title')}
      size="lg"
      footer={
        result ? (
          <Button onClick={close}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!valid} loading={run.isPending} icon={<HiOutlineGlobeAlt aria-hidden="true" />} onClick={() => run.mutate()}>
              {t('admin.website.submit')}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run.mutate();
          }}
        >
          <p className="rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm text-ink">{t('admin.website.body')}</p>
          <Field label={t('admin.website.url')} hint={t('admin.website.urlHint')} required>
            <Input type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="kb-max-pages" className="label mb-0">
                {t('admin.website.maxPages')}
              </label>
              <span className="text-sm font-medium tabular-nums text-ink-2" aria-hidden="true">
                {maxPages}
              </span>
            </div>
            <input
              id="kb-max-pages"
              type="range"
              min={1}
              max={15}
              step={1}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              aria-valuetext={t('admin.website.maxPagesValue', { n: maxPages })}
              className="w-full accent-[rgb(var(--primary))]"
            />
          </div>
        </form>
      ) : (
        <section role="status" aria-live="polite" className="space-y-4">
          <p className="text-sm text-ink-2">{t('admin.website.discovered', { count: fmtNumber(result.discovered, prefs.lang), site: result.site })}</p>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('admin.website.created', { count: result.created.length })}</h3>
            {!result.created.length ? (
              <p className="text-sm text-ink-3">{t('admin.website.none')}</p>
            ) : (
              <ul className="space-y-1.5">
                {result.created.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <HiOutlineCheckCircle className="shrink-0 text-success" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={c.url}>
                      {c.url}
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{t('admin.website.processing')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {result.skipped.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('admin.website.skipped', { count: result.skipped.length })}</h3>
              <ul className="space-y-1.5">
                {result.skipped.map((s) => (
                  <li key={s.url} className="flex min-w-0 items-start gap-2 text-sm">
                    <HiOutlineMinusCircle className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs" title={s.url}>
                        {s.url}
                      </span>
                      <span className="block text-xs text-ink-3">{s.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </Modal>
  );
}
