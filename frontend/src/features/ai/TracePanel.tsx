import { useState } from 'react';
import {
  HiChevronDown,
  HiOutlineBolt,
  HiOutlineCpuChip,
  HiOutlineDocumentMagnifyingGlass,
  HiOutlineShieldCheck,
  HiOutlineWrenchScrewdriver,
  HiOutlineExclamationTriangle,
} from 'react-icons/hi2';
import { Badge, statusTone } from '@/components/ui/Display';
import { useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import type { TraceStep, TurnTrace } from '@/types';

const stepIcon = { llm: HiOutlineCpuChip, tool: HiOutlineWrenchScrewdriver, policy: HiOutlineShieldCheck, validation: HiOutlineBolt };

function Json({ value }: { value: unknown }) {
  return <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-3 p-2.5 font-mono text-[0.7rem] leading-relaxed text-ink-2">{JSON.stringify(value, null, 2)}</pre>;
}

function Step({ step, index }: { step: TraceStep; index: number }) {
  const t = useT();
  const [open, setOpen] = useState(step.type === 'tool' && index < 6);
  const Icon = stepIcon[step.type];
  const detail = step.detail ?? {};
  return (
    <li className="relative pl-8">
      <span className={cn('absolute left-0 top-1 grid h-6 w-6 place-items-center rounded-full text-sm', step.type === 'tool' ? 'bg-primary-soft text-primary' : step.type === 'llm' ? 'bg-accent-soft text-accent-strong dark:text-accent' : 'bg-surface-3 text-ink-2')}>
        <Icon aria-hidden="true" />
      </span>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.8rem] font-semibold text-ink">{step.type === 'tool' ? `${step.name}()` : step.name}</span>
        <Badge tone={statusTone(step.status === 'OK' ? 'SUCCESS' : step.status)}>{step.status}</Badge>
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-3">{step.latencyMs} ms</span>
        <HiChevronDown className={cn('shrink-0 text-ink-3 transition', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && Object.keys(detail).length > 0 && (
        <div className="mt-2 space-y-2">
          {'args' in detail && (
            <div>
              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-3">{t('playground.arguments')}</p>
              <Json value={detail.args} />
            </div>
          )}
          {'result' in detail && (
            <div>
              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-3">{t('playground.result')}</p>
              <Json value={detail.result} />
            </div>
          )}
          {!('args' in detail) && <Json value={detail} />}
        </div>
      )}
    </li>
  );
}

/** Debug / observability panel. Never contains secrets: traces are built server-side from sanitized data. */
export function TracePanel({ trace, live }: { trace?: TurnTrace; live?: { name: string; type: string }[] }) {
  const t = useT();
  if (!trace)
    return (
      <div className="p-5">
        {live?.length ? (
          <ul className="space-y-2">
            {live.map((l, i) => (
              <li key={i} className="flex animate-slide-up items-center gap-2 font-mono text-xs text-ink-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> {l.type}: {l.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">{t('playground.noTrace')}</p>
        )}
      </div>
    );
  const kv = [
    [t('playground.intent'), t(`intents.${trace.intent}` as never) === `intents.${trace.intent}` ? trace.intent : `${t(`intents.${trace.intent}` as never)} (${trace.intent})`],
    [t('playground.category'), trace.category],
    [t('playground.confidence'), `${Math.round(trace.confidence * 100)}%`],
    [t('playground.provider'), trace.provider],
    [t('playground.model'), trace.model],
    [t('playground.latency'), `${trace.totalLatencyMs} ms`],
    [t('playground.llmLatency'), `${trace.llmLatencyMs} ms`],
    [t('playground.tokens'), `${trace.tokens.input.toLocaleString()} → ${trace.tokens.output.toLocaleString()}`],
    [t('playground.cost'), `$${trace.costUsd.toFixed(5)}`],
  ];
  return (
    <div className="space-y-5 p-4 sm:p-5">
      {trace.providerFallback && <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">{t('playground.fallback')}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {kv.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-3">{k}</dt>
            <dd className="truncate font-medium text-ink" title={String(v)}>
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
          <HiOutlineShieldCheck aria-hidden="true" /> {t('playground.policy')}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={trace.policy.mode === 'normal' ? 'success' : trace.policy.mode === 'emergency' ? 'danger' : 'warning'}>{trace.policy.mode}</Badge>
          {trace.policy.reasons.map((r) => (
            <Badge key={r}>{r}</Badge>
          ))}
          {trace.policy.forcedTool && <Badge tone="primary">force: {trace.policy.forcedTool}</Badge>}
        </div>
      </section>

      {Object.keys(trace.entities).length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{t('playground.entities')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(trace.entities)
              .filter(([k]) => !k.endsWith('Id'))
              .map(([k, v]) => (
                <span key={k} className="rounded-lg bg-surface-3 px-2 py-1 font-mono text-[0.7rem] text-ink-2">
                  {k}: <span className="text-ink">{String(v).slice(0, 32)}</span>
                </span>
              ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{t('playground.agentLoop')}</h3>
        <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-border">
          {trace.steps.map((s, i) => (
            <Step key={i} step={s} index={i} />
          ))}
        </ol>
      </section>

      {trace.retrieved.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
            <HiOutlineDocumentMagnifyingGlass aria-hidden="true" /> {t('playground.retrieved')}
          </h3>
          <ul className="space-y-2">
            {trace.retrieved.map((r, i) => (
              <li key={i} className="rounded-xl border border-border p-2.5 text-xs">
                <p className="flex justify-between gap-2 font-semibold">
                  <span className="truncate">{r.title}</span>
                  <span className="tabular-nums text-ink-3">{r.score.toFixed(3)}</span>
                </p>
                <p className="mt-1 line-clamp-3 text-ink-2">{r.excerpt}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(trace.violations.length > 0 || trace.errors.length > 0) && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-danger">
            <HiOutlineExclamationTriangle aria-hidden="true" /> {t('playground.violations')}
          </h3>
          <ul className="space-y-1 font-mono text-xs text-danger">
            {[...trace.violations, ...trace.errors].map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
