import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, Card, CardHeader, Pagination, statusTone } from '@/components/ui/Display';
import { SkeletonRows } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Field';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface AuditRow {
  id: string;
  actorType: string;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export default function AuditSettings() {
  const t = useT();
  const { prefs } = usePreferences();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actorType, setActorType] = useState('');
  const q = useQuery({ queryKey: ['audit', { page, search, actorType }], queryFn: () => api.page<AuditRow>('/audit-logs', { page, pageSize: 25, search, actorType }), placeholderData: keepPreviousData });
  return (
    <Card>
      <CardHeader title={t('settings.auditLog')} subtitle={t('patients.privacyNote')} />
      <div className="flex flex-col gap-2 border-y border-border p-3 sm:flex-row">
        <Input aria-label={t('common.search')} placeholder={`${t('common.search')}: patient.viewed, ai.tool_executed…`} value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        <Select aria-label={t('settings.actor')} value={actorType} onChange={(e) => (setActorType(e.target.value), setPage(1))} className="sm:w-48">
          <option value="">{t('common.all')}</option>
          {['USER', 'AI_AGENT', 'SYSTEM', 'WEBHOOK', 'PATIENT'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
      </div>
      {q.isLoading ? (
        <SkeletonRows className="p-4" />
      ) : (
        <>
          <DataTable
            caption={t('settings.auditLog')}
            rows={q.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'at', header: t('common.date'), cell: (r) => <span className="whitespace-nowrap text-ink-2">{fmtDateTime(r.createdAt, prefs.lang)}</span> },
              {
                key: 'actor',
                header: t('settings.actor'),
                cell: (r) => (
                  <div>
                    <p className="font-medium">{r.actorName ?? '—'}</p>
                    <Badge tone={r.actorType === 'AI_AGENT' ? 'primary' : 'neutral'}>{r.actorType}</Badge>
                  </div>
                ),
              },
              { key: 'action', header: t('settings.action'), cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
              { key: 'entity', header: t('settings.entity'), hideBelow: 'lg', cell: (r) => <span className="text-xs text-ink-3">{r.entityType} {r.entityId ? `· ${String(r.entityId).slice(0, 18)}` : ''}</span> },
              { key: 'result', header: t('settings.result'), cell: (r) => <Badge tone={statusTone(r.result)}>{r.result}</Badge> },
            ]}
            mobileCard={(r) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{r.action}</span>
                  <Badge tone={statusTone(r.result)}>{r.result}</Badge>
                </div>
                <p className="mt-1 text-sm">
                  {r.actorName} · <span className="text-ink-3">{r.actorType}</span>
                </p>
                <p className="text-xs text-ink-3">{fmtDateTime(r.createdAt, prefs.lang)}</p>
              </div>
            )}
          />
          <Pagination page={page} totalPages={q.data?.meta.totalPages ?? 1} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
