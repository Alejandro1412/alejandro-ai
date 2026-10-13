import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineShieldCheck } from 'react-icons/hi2';
import { Meter } from '@/components/charts/Charts';
import { Button } from '@/components/ui/Button';
import { Badge, statusTone } from '@/components/ui/Display';
import { ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Drawer } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, fmtMoney, fmtRelative } from '@/lib/format';
import { fmtUsd } from './format';
import { buildImpersonationUrl } from './impersonation';
import { SubscriptionBadge } from './SubscriptionBadge';
import { PLAN_KEYS, type AdminTenantDetail, type PlanKey } from './types';

type Action = 'plan' | 'trial' | 'suspend' | 'reactivate' | 'impersonate';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

export function TenantDrawer({ tenantId, onClose }: { tenantId: string | null; onClose: () => void }) {
  const t = useT();
  const { prefs } = usePreferences();
  const lang = prefs.lang;
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'tenant', tenantId], queryFn: () => api.get<AdminTenantDetail>(`/admin/tenants/${tenantId}`), enabled: Boolean(tenantId) });
  const d = q.data;

  const [planKey, setPlanKey] = useState<PlanKey>('PROFESSIONAL');
  const [interval, setInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [days, setDays] = useState(14);
  const [suspendReason, setSuspendReason] = useState('');
  const [impReason, setImpReason] = useState('');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const tabRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!d) return;
    setPlanKey(d.plan?.key ?? 'PROFESSIONAL');
    setInterval(d.subscription?.interval ?? 'MONTHLY');
  }, [d]);
  useEffect(() => {
    setSuspendReason('');
    setImpReason('');
    setDays(14);
    setConfirm(null);
  }, [tenantId]);

  const clinicName = d?.clinic?.name ?? d?.name ?? '';
  const status = d?.subscription?.status;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });

  const act = useMutation({
    mutationFn: async (a: Action) => {
      const base = `/admin/tenants/${tenantId}`;
      if (a === 'plan') return api.post(`${base}/plan`, { planKey, interval });
      if (a === 'trial') return api.post(`${base}/extend-trial`, { days });
      if (a === 'suspend') return api.post(`${base}/suspend`, { reason: suspendReason.trim() });
      if (a === 'reactivate') return api.post(`${base}/reactivate`);
      const tab = tabRef.current!;
      try {
        const r = await api.post<{ accessToken: string; expiresIn: number; asUser: string }>(`${base}/impersonate`, { reason: impReason.trim() });
        tab.location.href = buildImpersonationUrl({ token: r.accessToken, asUser: r.asUser, expiresIn: r.expiresIn });
        return r;
      } catch (e) {
        tab.close();
        throw e;
      } finally {
        tabRef.current = null;
      }
    },
    onSuccess: (_r, a) => {
      const msg = { plan: t('admin.tenant.planChanged'), trial: t('admin.tenant.trialExtended'), suspend: t('admin.tenant.suspended'), reactivate: t('admin.tenant.reactivated'), impersonate: t('admin.tenant.impersonationStarted') }[a];
      toast.success(msg);
      if (a === 'suspend') setSuspendReason('');
      if (a === 'impersonate') setImpReason('');
      setConfirm(null);
      refresh();
    },
    onError: (e) => {
      setConfirm(null);
      toast.error(t('common.errorGeneric'), errorMessage(e));
    },
  });

  const intervalLabel = interval === 'YEARLY' ? t('admin.tenant.yearly') : t('admin.tenant.monthly');
  const confirmText: Record<Action, string> = {
    plan: t('admin.tenant.confirmPlan', { clinic: clinicName, plan: t(`admin.plans.${planKey}`), interval: intervalLabel }),
    trial: t('admin.tenant.confirmTrial', { clinic: clinicName, days }),
    suspend: t('admin.tenant.confirmSuspend', { clinic: clinicName, reason: suspendReason.trim() }),
    reactivate: `${t('admin.tenant.confirmReactivate', { clinic: clinicName })} ${t('admin.tenant.reactivateBody')}`,
    impersonate: `${t('admin.tenant.confirmImpersonate', { clinic: clinicName, reason: impReason.trim() })} ${t('admin.tenant.impersonateHint')}`,
  };
  const confirmTitle: Record<Action, string> = {
    plan: t('admin.tenant.changePlan'),
    trial: t('admin.tenant.extendTrial'),
    suspend: t('admin.tenant.suspend'),
    reactivate: t('admin.tenant.reactivate'),
    impersonate: t('admin.tenant.impersonate'),
  };
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 90;
  const reasonValid = (r: string) => r.trim().length >= 3 && r.trim().length <= 300;
  const budget = d?.aiBudget;

  return (
    <Drawer open={Boolean(tenantId)} onClose={onClose} title={clinicName || t('admin.console.tenants')} width="max-w-xl">
      {q.isLoading || !d ? (
        q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={6} className="p-5" />
      ) : (
        <div className="pb-8">
          <div className="space-y-2 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <SubscriptionBadge status={status} />
              {d.plan && <Badge tone="primary">{d.plan.name}</Badge>}
              {d.subscription && <Badge>{d.subscription.interval === 'YEARLY' ? t('admin.tenant.yearly') : t('admin.tenant.monthly')}</Badge>}
            </div>
            <p className="text-sm text-ink-2">
              {d.clinic?.slug}
              {d.clinic?.city ? ` · ${d.clinic.city}` : ''} · {t('admin.tenant.since', { date: fmtDate(d.createdAt, lang) })}
            </p>
            {d.subscription?.suspendedReason && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{t('admin.tenant.suspendedReason', { reason: d.subscription.suspendedReason })}</p>}
            <dl className="grid grid-cols-2 gap-3 pt-2 text-sm sm:grid-cols-4">
              {[
                [t('admin.console.colUsers'), d.users],
                [t('admin.console.colDoctors'), d.doctors],
                [t('admin.console.colConversations'), d.conversationsThisMonth],
                [t('admin.console.colAiCost'), fmtUsd(d.aiCostUsd, lang)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {d.subscription && (
              <p className="text-xs text-ink-3">
                {d.subscription.trialEndsAt && `${t('admin.console.trialEnds', { date: fmtDate(d.subscription.trialEndsAt, lang) })} · `}
                {d.subscription.currentPeriodEnd && t('admin.console.periodEnds', { date: fmtDate(d.subscription.currentPeriodEnd, lang) })}
                {d.subscription.graceEndsAt && ` · ${t('admin.console.graceEnds', { date: fmtDate(d.subscription.graceEndsAt, lang) })}`}
              </p>
            )}
          </div>

          {budget && (
            <Section title={t('admin.tenant.aiBudget')}>
              <p className="mb-2 text-sm tabular-nums">
                {budget.capUsd === null ? t('admin.billing.spentNoCap', { spent: fmtUsd(budget.spentUsd, lang) }) : t('admin.billing.spent', { spent: fmtUsd(budget.spentUsd, lang), cap: fmtUsd(budget.capUsd, lang) })}
              </p>
              {budget.capUsd !== null && <Meter value={budget.capUsd > 0 ? (budget.spentUsd / budget.capUsd) * 100 : 100} label={t('admin.tenant.aiBudget')} />}
              {budget.exceeded && <p className="mt-2 text-xs font-medium text-warning">{t('admin.billing.exceeded')}</p>}
            </Section>
          )}

          <Section title={t('admin.tenant.actions')}>
            <div className="space-y-5">
              <form
                className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  setConfirm('plan');
                }}
              >
                <Field label={t('admin.tenant.plan')}>
                  <Select value={planKey} onChange={(e) => setPlanKey(e.target.value as PlanKey)}>
                    {PLAN_KEYS.map((p) => (
                      <option key={p} value={p}>
                        {t(`admin.plans.${p}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('admin.tenant.interval')}>
                  <Select value={interval} onChange={(e) => setInterval(e.target.value as 'MONTHLY' | 'YEARLY')}>
                    <option value="MONTHLY">{t('admin.tenant.monthly')}</option>
                    <option value="YEARLY">{t('admin.tenant.yearly')}</option>
                  </Select>
                </Field>
                <Button type="submit" variant="secondary">
                  {t('admin.tenant.applyPlan')}
                </Button>
              </form>

              <form
                className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (daysValid) setConfirm('trial');
                }}
              >
                <Field label={t('admin.tenant.extendTrial')} hint={t('admin.tenant.daysHint')}>
                  <Input type="number" inputMode="numeric" min={1} max={90} value={Number.isNaN(days) ? '' : days} onChange={(e) => setDays(e.target.valueAsNumber)} disabled={status === 'ACTIVE'} />
                </Field>
                <Button type="submit" variant="secondary" disabled={!daysValid || status === 'ACTIVE'} className="sm:mb-6">
                  {t('admin.tenant.extend')}
                </Button>
              </form>

              {status === 'SUSPENDED' ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                  <p className="flex-1 text-sm text-ink-2">{t('admin.tenant.reactivateBody')}</p>
                  <Button variant="primary" onClick={() => setConfirm('reactivate')}>
                    {t('admin.tenant.reactivate')}
                  </Button>
                </div>
              ) : (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reasonValid(suspendReason)) setConfirm('suspend');
                  }}
                >
                  <Field label={t('admin.tenant.suspendReason')} hint={t('admin.tenant.suspendHint')} error={suspendReason && !reasonValid(suspendReason) ? t('admin.tenant.reasonMin') : undefined} required>
                    <Textarea rows={2} maxLength={300} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} className="min-h-[64px]" />
                  </Field>
                  <div className="flex flex-wrap justify-end gap-2">
                    {(status === 'EXPIRED' || status === 'CANCELED' || status === 'PAST_DUE') && (
                      <Button variant="secondary" onClick={() => setConfirm('reactivate')}>
                        {t('admin.tenant.reactivate')}
                      </Button>
                    )}
                    <Button type="submit" variant="danger" disabled={!reasonValid(suspendReason)}>
                      {t('admin.tenant.suspend')}
                    </Button>
                  </div>
                </form>
              )}

              <form
                className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft/50 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reasonValid(impReason)) setConfirm('impersonate');
                }}
              >
                <p className="flex items-start gap-2 text-sm text-ink">
                  <HiOutlineShieldCheck className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  {t('admin.tenant.impersonateHint')}
                </p>
                <Field label={t('admin.tenant.impersonateReason')} error={impReason && !reasonValid(impReason) ? t('admin.tenant.reasonMin') : undefined} required>
                  <Input maxLength={300} value={impReason} onChange={(e) => setImpReason(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="secondary" icon={<HiOutlineArrowTopRightOnSquare aria-hidden="true" />} disabled={!reasonValid(impReason)}>
                    {t('admin.tenant.impersonate')}
                  </Button>
                </div>
              </form>
            </div>
          </Section>

          <Section title={t('admin.tenant.team')}>
            <ul className="divide-y divide-border text-sm">
              {d.team.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="block truncate text-xs text-ink-3">{m.email}</span>
                  </span>
                  <Badge>{t(`settings.roles.${m.role}` as never)}</Badge>
                  <span className="w-full text-xs text-ink-3 sm:w-auto">{m.lastLoginAt ? t('admin.tenant.lastLogin', { when: fmtRelative(m.lastLoginAt, lang) }) : t('admin.tenant.neverLoggedIn')}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t('admin.tenant.usage')}>
            {!d.usage.length ? (
              <p className="text-sm text-ink-3">{t('admin.tenant.noUsage')}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('admin.tenant.usage')}</caption>
                <thead className="text-xs text-ink-3">
                  <tr>
                    <th scope="col" className="py-1.5 font-medium">
                      {t('admin.tenant.kind')}
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      {t('admin.tenant.quantity')}
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      {t('admin.tenant.cost')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.usage.map((u) => (
                    <tr key={u.kind} className="border-t border-border">
                      <td className="py-1.5 font-mono text-xs">{u.kind}</td>
                      <td className="py-1.5 text-right tabular-nums">{u.quantity}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtUsd(u.costUsd, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={t('admin.tenant.invoices')}>
            {!d.invoices.length ? (
              <p className="text-sm text-ink-3">{t('admin.tenant.noInvoices')}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {d.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs">{i.number}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {fmtDate(i.issuedAt, lang)}
                        {i.description ? ` · ${i.description}` : ''}
                      </span>
                    </span>
                    <span className="tabular-nums">{fmtMoney(i.amountCents, i.currency, lang)}</span>
                    <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {confirm && (
            <ConfirmDialog
              open
              onClose={() => !act.isPending && setConfirm(null)}
              onConfirm={() => {
                if (confirm === 'impersonate') {
                  // Open the tab inside the click so pop-up blockers allow it; it is pointed at the hand-off page later.
                  const tab = window.open('about:blank', '_blank');
                  if (!tab) {
                    toast.error(t('admin.tenant.popupBlocked'));
                    return;
                  }
                  tab.opener = null;
                  tabRef.current = tab;
                }
                act.mutate(confirm);
              }}
              title={confirmTitle[confirm]}
              body={confirmText[confirm]}
              confirmLabel={confirmTitle[confirm]}
              danger={confirm === 'suspend'}
              loading={act.isPending}
            />
          )}
        </div>
      )}
    </Drawer>
  );
}
