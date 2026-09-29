import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  HiMagnifyingGlass,
  HiOutlineArrowUpTray,
  HiOutlineBookOpen,
  HiOutlineDocumentText,
  HiOutlineGlobeAlt,
  HiOutlineInformationCircle,
  HiOutlineQuestionMarkCircle,
} from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, Card, CardHeader, PageHeader, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import type { KnowledgeSource } from '@/types';
import { KnowledgeDialogs, type KbDialog } from './KnowledgeDialogs';

const typeIcon = { PDF: HiOutlineDocumentText, DOCX: HiOutlineDocumentText, TXT: HiOutlineDocumentText, TEXT: HiOutlineDocumentText, FAQ: HiOutlineQuestionMarkCircle, URL: HiOutlineGlobeAlt };

export default function KnowledgePage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<KbDialog>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const list = useQuery({
    queryKey: ['knowledge', 'list'],
    queryFn: () => api.page<KnowledgeSource>('/knowledge/documents', { pageSize: 100 }),
    refetchInterval: (q) => (q.state.data?.items.some((s) => s.status === 'PROCESSING' || s.status === 'UPLOADING') ? 2000 : false),
  });
  const stats = useQuery({ queryKey: ['knowledge', 'stats'], queryFn: () => api.get<{ totalSources: number; totalChunks: number; embeddingModel: string }>('/knowledge/stats') });
  const search = useQuery({
    queryKey: ['knowledge', 'search', submitted],
    queryFn: () => api.get<{ chunkId: string; title: string; content: string; score: number; vectorScore: number; keywordScore: number }[]>('/knowledge/search', { q: submitted }),
    enabled: submitted.length >= 2,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('knowledge.title')}
        subtitle={t('knowledge.subtitle')}
        actions={
          can('knowledge.write') && (
            <>
              <Button icon={<HiOutlineArrowUpTray aria-hidden="true" />} onClick={() => setDialog('upload')}>
                {t('knowledge.upload')}
              </Button>
              <Button variant="secondary" onClick={() => setDialog('faq')}>
                {t('knowledge.addFaq')}
              </Button>
              <Button variant="secondary" onClick={() => setDialog('text')}>
                {t('knowledge.addText')}
              </Button>
              <Button variant="secondary" onClick={() => setDialog('url')}>
                {t('knowledge.addUrl')}
              </Button>
            </>
          )
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-ink">
        <HiOutlineInformationCircle className="mt-0.5 shrink-0 text-lg text-info" aria-hidden="true" />
        <p>
          {t('knowledge.ragRule')}
          {stats.data && <span className="mt-1 block text-xs text-ink-2">{t('knowledge.stats', { sources: stats.data.totalSources, chunks: stats.data.totalChunks })} · {stats.data.embeddingModel}</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          {list.isLoading ? (
            <SkeletonRows rows={6} className="p-4" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !list.data?.items.length ? (
            <EmptyState icon={<HiOutlineBookOpen />} title={t('knowledge.empty')} body={t('knowledge.emptyBody')} action={can('knowledge.write') && <Button onClick={() => setDialog('upload')}>{t('knowledge.upload')}</Button>} />
          ) : (
            <DataTable
              caption={t('knowledge.title')}
              rows={list.data.items}
              rowKey={(s) => s.id}
              onRowClick={(s) => nav(`/knowledge/${s.id}`)}
              columns={[
                {
                  key: 'title',
                  header: t('knowledge.titleField'),
                  cell: (s) => {
                    const Icon = typeIcon[s.type];
                    return (
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-lg text-ink-2">
                          <Icon aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.title}</p>
                          <p className="truncate text-xs text-ink-3">{s.error ?? s.fileName ?? s.sourceUrl ?? s.category}</p>
                        </div>
                      </div>
                    );
                  },
                },
                { key: 'type', header: t('knowledge.type'), hideBelow: 'lg', cell: (s) => <Badge>{s.type}</Badge> },
                { key: 'chunks', header: 'Chunks', cell: (s) => <span className="tabular-nums">{s.chunkCount}</span> },
                {
                  key: 'status',
                  header: t('common.status'),
                  cell: (s) => (
                    <Badge tone={statusTone(s.status)} dot>
                      {t(`status.${s.status}` as never)}
                    </Badge>
                  ),
                },
                { key: 'updated', header: t('common.updated'), hideBelow: 'xl', cell: (s) => <span className="text-ink-3">{fmtRelative(s.updatedAt, prefs.lang)}</span> },
              ]}
              mobileCard={(s) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.title}</p>
                    <p className="text-xs text-ink-3">
                      {s.type} · {t('knowledge.chunks', { count: s.chunkCount })}
                    </p>
                  </div>
                  <Badge tone={statusTone(s.status)} dot>
                    {t(`status.${s.status}` as never)}
                  </Badge>
                </div>
              )}
            />
          )}
        </Card>

        <Card aria-labelledby="kb-test">
          <CardHeader id="kb-test" title={t('knowledge.testSearch')} icon={<HiMagnifyingGlass />} />
          <form
            className="flex gap-2 px-5"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(query.trim());
            }}
          >
            <Input aria-label={t('knowledge.testSearch')} placeholder={t('knowledge.testPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button type="submit" variant="secondary" loading={search.isFetching}>
              {t('common.search')}
            </Button>
          </form>
          <ul className="space-y-2 p-5" aria-live="polite">
            {search.data?.length === 0 && <li className="text-sm text-ink-3">{t('common.noResults')}</li>}
            {search.data?.map((r) => (
              <li key={r.chunkId} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-semibold">{r.title}</p>
                  <Badge tone="primary">{Math.round(r.score * 100)}%</Badge>
                </div>
                <p className="mt-1 line-clamp-4 text-ink-2">{r.content}</p>
                <p className="mt-1 font-mono text-[0.68rem] text-ink-3">
                  vector {r.vectorScore.toFixed(3)} · keyword {r.keywordScore.toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <KnowledgeDialogs open={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
