import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { HiOutlineArrowUpTray, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';

export type KbDialog = 'upload' | 'text' | 'faq' | 'url' | null;

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

  const titles = { upload: t('knowledge.upload'), text: t('knowledge.addText'), faq: t('knowledge.addFaq'), url: t('knowledge.addUrl') };

  return (
    <Modal
      open={open !== null}
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
  );
}
