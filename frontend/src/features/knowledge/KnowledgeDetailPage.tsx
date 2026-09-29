import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiArrowLeft, HiOutlineArrowPath, HiOutlineTrash } from 'react-icons/hi2';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, Card, Tabs, statusTone } from '@/components/ui/Display';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Switch } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { KnowledgeSource } from '@/types';

export default function KnowledgeDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'chunks' | 'raw'>('chunks');
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const q = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => api.get<KnowledgeSource>(`/knowledge/documents/${id}`),
    refetchInterval: (qq) => (qq.state.data?.status === 'PROCESSING' || qq.state.data?.status === 'UPLOADING' ? 2000 : false),
  });
  useEffect(() => {
    if (q.data) {
      setTitle(q.data.title);
      setCategory(q.data.category ?? '');
    }
  }, [q.data]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['knowledge'] });
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/knowledge/documents/${id}`, body), onSuccess: () => (toast.success(t('common.saved')), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  const reprocess = useMutation({ mutationFn: () => api.post(`/knowledge/documents/${id}/reprocess`), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.delete(`/knowledge/documents/${id}`),
    onSuccess: () => {
      toast.success(t('knowledge.deleted'));
      refresh();
      nav('/knowledge');
    },
  });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const editable = can('knowledge.write');

  return (
    <div className="space-y-4">
      <Link to="/knowledge" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <HiArrowLeft aria-hidden="true" /> {t('knowledge.title')}
      </Link>
      <Card>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{s.title}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={statusTone(s.status)} dot>
                {t(`status.${s.status}` as never)}
              </Badge>
              <Badge>{s.type}</Badge>
              <Badge>{t('knowledge.chunks', { count: s.chunkCount })}</Badge>
              {s.processedAt && <Badge>{fmtDateTime(s.processedAt, prefs.lang)}</Badge>}
            </div>
            {s.error && (
              <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
                {s.error}
              </p>
            )}
          </div>
          {editable && (
            <div className="flex gap-2">
              <Button variant="secondary" icon={<HiOutlineArrowPath aria-hidden="true" />} loading={reprocess.isPending} onClick={() => reprocess.mutate()}>
                {t('knowledge.reprocess')}
              </Button>
              <Button variant="danger" icon={<HiOutlineTrash aria-hidden="true" />} onClick={() => setConfirm(true)}>
                {t('common.delete')}
              </Button>
            </div>
          )}
        </div>
        {editable && (
          <div className="grid grid-cols-1 gap-4 border-t border-border p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label={t('knowledge.titleField')}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t('knowledge.category')}>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </Field>
            <Button variant="secondary" onClick={() => update.mutate({ title, category: category || null })}>
              {t('common.save')}
            </Button>
            <div className="sm:col-span-3">
              <Switch label={s.isEnabled ? t('knowledge.disable') : t('knowledge.enable')} description={t('knowledge.ragRule')} checked={s.isEnabled} onChange={(v) => update.mutate({ isEnabled: v })} />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="px-4 pt-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'chunks', label: t('knowledge.preview'), count: s.chunks?.length },
              { value: 'raw', label: t('knowledge.rawText') },
            ]}
          />
        </div>
        {tab === 'chunks' ? (
          <ol className="space-y-3 p-5">
            {s.chunks?.map((c) => (
              <li key={c.id} className="rounded-xl border border-border bg-surface-2 p-3">
                <p className="mb-1 font-mono text-[0.68rem] text-ink-3">
                  #{c.index} · ~{c.tokenCount} tokens
                </p>
                <p className="whitespace-pre-line text-sm text-ink">{c.content}</p>
              </li>
            ))}
          </ol>
        ) : null}
        {tab === 'raw' && <pre className="scrollbar-thin mx-5 mb-5 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-sm text-ink-2">{s.rawText ?? '—'}</pre>}
      </Card>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('common.delete')} body={t('knowledge.deleteConfirm', { title: s.title })} onConfirm={() => remove.mutate()} loading={remove.isPending} />
    </div>
  );
}
