import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HiOutlineAdjustmentsHorizontal, HiOutlineBeaker, HiOutlineLockClosed, HiOutlineShieldCheck } from 'react-icons/hi2';
import { AgentAvatar } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { Badge, Card, CardHeader, PageHeader, StatCard } from '@/components/ui/Display';
import { Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import type { AgentConfig } from '@/types';

interface ToolInfo {
  name: string;
  description: string;
  permission: string | null;
  sideEffect: boolean;
  requiresPatient: boolean;
  enabled: boolean;
  permitted: boolean;
}
interface Usage {
  rows: { kind: string; provider: string | null; model: string | null; calls: number; quantity: number; tokensIn: number; tokensOut: number; costUsd: number; avgLatencyMs: number }[];
  quota: { used: number; limit: number | null; overage: number };
}

const PIPELINE = ['User', 'Conversation', 'Intent & context', 'Policy engine', 'LLM ⇄ Tools', 'Validation', 'Audit', 'Reply'];

export default function AiOverviewPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const config = useQuery({ queryKey: ['ai', 'config'], queryFn: () => api.get<{ agent: AgentConfig; providers: Record<string, boolean> }>('/ai/config'), enabled: can('settings.manage') });
  const tools = useQuery({ queryKey: ['ai', 'tools'], queryFn: () => api.get<ToolInfo[]>('/ai/tools') });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api.get<Usage>('/ai/usage', { days: 30 }), enabled: can('analytics.read') });
  const toggle = useMutation({
    mutationFn: (v: { name: string; enabled: boolean }) => api.patch(`/ai/tools/${v.name}`, { enabled: v.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'tools'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const completions = usage.data?.rows.filter((r) => r.kind === 'AI_COMPLETION') ?? [];
  const tokens = completions.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
  const cost = completions.reduce((s, r) => s + r.costUsd, 0);
  const avgLatency = completions.length ? Math.round(completions.reduce((s, r) => s + r.avgLatencyMs * r.calls, 0) / Math.max(1, completions.reduce((s, r) => s + r.calls, 0))) : 0;
  const agent = config.data?.agent;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alejandro AI"
        subtitle={t('brand.tagline')}
        actions={
          <>
            {can('settings.manage') && (
              <ButtonLink to="/settings/ai" variant="secondary" icon={<HiOutlineAdjustmentsHorizontal aria-hidden="true" />}>
                {t('settings.title')}
              </ButtonLink>
            )}
            <ButtonLink to="/ai/playground" icon={<HiOutlineBeaker aria-hidden="true" />}>
              {t('nav.playground')}
            </ButtonLink>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
          <AgentAvatar size={64} online />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{agent?.name ?? 'Alejandro AI'}</h2>
              <Badge tone={agent?.isActive === false ? 'neutral' : 'success'} dot>
                {agent?.isActive === false ? t('common.disabled') : t('conversations.aiActive')}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-2">{t('brand.sub')}</p>
            {agent && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="primary">
                  {t('settings.provider')}: {agent.provider}
                </Badge>
                <Badge>
                  {t('settings.model')}: {agent.model}
                </Badge>
                <Badge>{agent.languages.join(' · ').toUpperCase()}</Badge>
                <Badge>{t(`settings.tones.${agent.tone}` as never)}</Badge>
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-border bg-surface-2 px-5 py-4">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-medium text-ink-2" aria-label="Pipeline">
            {PIPELINE.map((p, i) => (
              <li key={p} className="flex items-center gap-2">
                <span className="rounded-lg border border-border bg-surface px-2.5 py-1">{p}</span>
                {i < PIPELINE.length - 1 && <span aria-hidden="true">→</span>}
              </li>
            ))}
          </ol>
        </div>
      </Card>

      {can('analytics.read') && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('analytics.usage')}>
          {usage.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
          ) : (
            <>
              <StatCard label={t('analytics.quota')} value={`${fmtNumber(usage.data?.quota.used ?? 0, prefs.lang)}${usage.data?.quota.limit ? ` / ${fmtNumber(usage.data.quota.limit, prefs.lang)}` : ''}`} />
              <StatCard label={t('playground.tokens')} value={fmtNumber(tokens, prefs.lang)} tone="accent" />
              <StatCard label={t('analytics.estCost')} value={`$${cost.toFixed(2)}`} tone="info" />
              <StatCard label={t('analytics.avgLatency')} value={`${avgLatency} ms`} tone="success" />
            </>
          )}
        </section>
      )}

      <Card aria-labelledby="tools-h">
        <CardHeader id="tools-h" title={t('settings.allowedActions')} subtitle={t('settings.allowedActionsHint')} icon={<HiOutlineShieldCheck />} />
        <div className="px-2 pb-3">
          {tools.isLoading ? (
            <SkeletonRows rows={6} className="px-3" />
          ) : (
            <ul className="grid gap-x-6 divide-y divide-border px-3 md:grid-cols-2 md:divide-y-0">
              {tools.data?.map((tool) => (
                <li key={tool.name} className="border-border py-2 md:border-b">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-sm font-semibold">
                        {tool.name}
                        {tool.sideEffect && <Badge tone="warning">write</Badge>}
                        {!tool.permitted && (
                          <Badge tone="danger">
                            <HiOutlineLockClosed aria-hidden="true" /> RBAC
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{tool.description}</p>
                      {tool.permission && <p className="mt-0.5 font-mono text-[0.68rem] text-ink-3">{tool.permission}</p>}
                    </div>
                    {can('settings.manage') ? (
                      <div className="shrink-0">
                        <Switch hideLabel label={tool.name} checked={tool.enabled} onChange={(v) => toggle.mutate({ name: tool.name, enabled: v })} />
                      </div>
                    ) : (
                      <Badge tone={tool.enabled ? 'success' : 'neutral'}>{tool.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
