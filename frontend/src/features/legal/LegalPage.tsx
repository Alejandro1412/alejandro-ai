import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineArrowUp, HiOutlineBuildingOffice2, HiOutlineDocumentText, HiOutlineExclamationTriangle, HiOutlinePrinter } from 'react-icons/hi2';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { LangSwitch, ThemeMenu } from '@/layouts/Controls';
import { dpa } from './content/dpa';
import { privacy } from './content/privacy';
import { terms } from './content/terms';
import { isLegalDoc, LEGAL_DOCS, LEGAL_LAST_UPDATED, type LegalDocKey, type LegalDocSet } from './types';

const CONTENT: Record<LegalDocKey, LegalDocSet> = { terms, privacy, dpa };

interface PublicClinic {
  clinic: {
    name: string;
    slug: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    privacyPolicyUrl: string | null;
    consentVersion?: string | null;
  };
}

/** Public legal templates: /legal/terms | /legal/privacy | /legal/dpa, optional ?clinic=slug (controller block). */
export default function LegalPage() {
  const { doc } = useParams();
  const [params] = useSearchParams();
  const clinicSlug = params.get('clinic')?.trim() || null;
  const t = useT();
  const { prefs, resolvedTheme } = usePreferences();
  const content = isLegalDoc(doc) ? CONTENT[doc][prefs.lang] : null;
  const qs = clinicSlug ? `?clinic=${encodeURIComponent(clinicSlug)}` : '';

  const clinic = useQuery({
    queryKey: ['public-clinic', clinicSlug],
    queryFn: () => api.request<PublicClinic>(`/public/clinics/${encodeURIComponent(clinicSlug!)}`, { anonymous: true }).then((r) => r.data),
    enabled: Boolean(clinicSlug && content),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!content) return;
    const prev = document.title;
    document.title = `${content.title} · Alejandro AI`;
    return () => {
      document.title = prev;
    };
  }, [content]);

  // Always print in the light palette, whatever theme is on screen.
  useEffect(() => {
    const before = () => document.documentElement.classList.remove('dark');
    const after = () => document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [resolvedTheme]);

  const active = useActiveSection(content?.sections.map((s) => s.id) ?? []);

  return (
    <div className="min-h-dvh bg-bg print:bg-white" id="top">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label={`Alejandro AI — ${t('pub.legal.home')}`} data-no-underline>
            <Logo size={30} />
          </Link>
          <div className="flex items-center">
            <LangSwitch />
            <ThemeMenu />
          </div>
        </div>
        <nav aria-label={t('pub.legal.otherDocs')} className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {LEGAL_DOCS.map((d) => (
              <li key={d}>
                <Link
                  to={`/legal/${d}${qs}`}
                  aria-current={d === doc ? 'page' : undefined}
                  data-no-underline
                  className={cn('inline-flex whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', d === doc ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
                >
                  {t(`pub.legal.${d}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {!content ? (
        <main id="main" className="mx-auto max-w-xl px-4 py-16">
          <EmptyState
            icon={<HiOutlineDocumentText aria-hidden="true" />}
            title={t('pub.legal.notFoundTitle')}
            body={t('pub.legal.notFoundBody')}
            action={
              <>
                {LEGAL_DOCS.map((d) => (
                  <Link key={d} to={`/legal/${d}${qs}`} className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft">
                    {t(`pub.legal.${d}`)}
                  </Link>
                ))}
                <Link to="/" className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2">
                  {t('pub.legal.home')}
                </Link>
              </>
            }
          />
        </main>
      ) : (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[15rem_minmax(0,1fr)] print:block print:max-w-none print:p-0">
          <aside className="hidden lg:block print:hidden">
            <nav aria-label={t('pub.legal.toc')} className="sticky top-32 max-h-[calc(100dvh-9rem)] overflow-y-auto pr-2 scrollbar-thin">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{t('pub.legal.toc')}</p>
              <TocList sections={content.sections} active={active} />
            </nav>
          </aside>

          <main id="main" className="page-enter min-w-0 max-w-3xl print:max-w-none">
            <div role="note" className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4 print:border-black">
              <HiOutlineExclamationTriangle className="mt-0.5 shrink-0 text-xl text-warning" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold text-ink">{t('pub.legal.disclaimerTitle')}</p>
                <p className="text-ink-2">{t('pub.legal.disclaimer')}</p>
              </div>
            </div>

            <header className="mb-6">
              <h1 className="text-2xl font-bold leading-tight text-ink text-balance sm:text-3xl">{content.title}</h1>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-3">{t('pub.legal.lastUpdated', { date: LEGAL_LAST_UPDATED })}</p>
                <Button variant="secondary" size="sm" className="print:hidden" icon={<HiOutlinePrinter aria-hidden="true" />} onClick={() => window.print()}>
                  {t('pub.legal.print')}
                </Button>
              </div>
            </header>

            {clinicSlug && <ControllerBlock loading={clinic.isLoading} data={clinic.data?.clinic} failed={clinic.isError} />}

            <p className="mb-6 text-[0.975rem] leading-relaxed text-ink-2">{content.intro}</p>

            <details className="mb-8 rounded-2xl border border-border bg-surface p-4 lg:hidden print:hidden">
              <summary className="cursor-pointer text-sm font-semibold text-ink">{t('pub.legal.toc')}</summary>
              <div className="mt-3">
                <TocList sections={content.sections} active={active} />
              </div>
            </details>

            <article className="space-y-8">
              {content.sections.map((s) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-32 break-inside-avoid-page">
                  <h2 id={`${s.id}-h`} className="mb-3 text-lg font-semibold text-ink">
                    {s.title}
                  </h2>
                  <div className="space-y-3 text-[0.95rem] leading-relaxed text-ink-2">
                    {s.blocks.map((b, i) =>
                      Array.isArray(b) ? (
                        <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-ink-3">
                          {b.map((li, j) => (
                            <li key={j}>{li}</li>
                          ))}
                        </ul>
                      ) : (
                        <p key={i}>{b}</p>
                      ),
                    )}
                  </div>
                </section>
              ))}
            </article>

            <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm print:hidden">
              <nav aria-label={t('pub.legal.otherDocs')} className="flex flex-wrap gap-x-4 gap-y-2">
                {LEGAL_DOCS.filter((d) => d !== doc).map((d) => (
                  <Link key={d} to={`/legal/${d}${qs}`} className="font-medium text-primary hover:underline">
                    {t(`pub.legal.${d}`)}
                  </Link>
                ))}
                <Link to="/" className="font-medium text-ink-2 hover:text-ink hover:underline">
                  {t('pub.legal.home')}
                </Link>
              </nav>
              <a href="#top" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                <HiOutlineArrowUp aria-hidden="true" /> {t('pub.legal.backToTop')}
              </a>
            </footer>
          </main>
        </div>
      )}
    </div>
  );
}

function TocList({ sections, active }: { sections: { id: string; title: string }[]; active: string | null }) {
  return (
    <ol className="space-y-0.5 text-sm">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            aria-current={active === s.id ? 'location' : undefined}
            data-no-underline
            className={cn('block rounded-lg px-2.5 py-1.5 leading-snug', active === s.id ? 'bg-primary-soft font-medium text-primary' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
          >
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

function ControllerBlock({ loading, data, failed }: { loading: boolean; data?: PublicClinic['clinic']; failed: boolean }) {
  const t = useT();
  if (loading)
    return (
      <div className="mb-6 space-y-2 rounded-2xl border border-border bg-surface p-5" role="status" aria-label={t('pub.legal.controllerLoading')}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  if (failed || !data) return <p className="mb-6 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">{t('pub.legal.controllerMissing')}</p>;
  const address = [data.address, data.city, data.country].filter(Boolean).join(', ');
  const rows: { label: string; value: string; href?: string }[] = [
    ...(address ? [{ label: t('pub.legal.address'), value: address }] : []),
    ...(data.email ? [{ label: t('pub.legal.email'), value: data.email, href: `mailto:${data.email}` }] : []),
    ...(data.phone ? [{ label: t('pub.legal.phone'), value: data.phone, href: `tel:${data.phone.replace(/[^\d+]/g, '')}` }] : []),
    ...(data.website ? [{ label: t('pub.legal.website'), value: data.website.replace(/^https?:\/\//, ''), href: data.website }] : []),
  ];
  return (
    <section aria-labelledby="controller-h" className="mb-6 overflow-hidden rounded-2xl border border-primary/30 bg-surface print:border-black">
      <div className="flex items-center gap-2 bg-primary-soft px-5 py-2.5 text-sm font-semibold text-primary">
        <HiOutlineBuildingOffice2 aria-hidden="true" />
        <h2 id="controller-h">{t('pub.legal.controllerTitle')}</h2>
      </div>
      <div className="p-5">
        <p className="text-lg font-bold text-ink">{data.name}</p>
        <p className="mt-1 text-sm text-ink-2">{t('pub.legal.controllerBody', { clinic: data.name })}</p>
        {rows.length > 0 && (
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="min-w-0">
                <dt className="text-xs font-medium text-ink-3">{r.label}</dt>
                <dd className="break-words text-ink">
                  {r.href ? (
                    <a href={r.href} className="text-primary hover:underline" {...(r.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                      {r.value}
                    </a>
                  ) : (
                    r.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {data.privacyPolicyUrl && (
          <div className="mt-5 rounded-xl border border-info/30 bg-info-soft p-4">
            <p className="font-semibold text-ink">{t('pub.legal.clinicPolicyTitle')}</p>
            <p className="mt-0.5 text-sm text-ink-2">{t('pub.legal.clinicPolicyBody')}</p>
            <a
              href={data.privacyPolicyUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-no-underline
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-strong print:hidden"
            >
              {t('pub.legal.clinicPolicyCta', { clinic: data.name })} <HiOutlineArrowTopRightOnSquare aria-hidden="true" />
              <span className="sr-only">{t('pub.chat.newTab')}</span>
            </a>
            <p className="mt-2 hidden break-all text-xs print:block">{data.privacyPolicyUrl}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Highlights the section currently in view in the table of contents (no-op without IntersectionObserver). */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !key) return;
    const els = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-120px 0px -65% 0px' },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [key]);
  return active;
}
