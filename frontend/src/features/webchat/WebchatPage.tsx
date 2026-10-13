import { useParams, useSearchParams } from 'react-router-dom';
import { AgentAvatar } from '@/components/brand/Logo';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import { A11yButton, LangSwitch } from '@/layouts/Controls';
import { useWebchat } from './useWebchat';
import { WebchatPanel } from './WebchatPanel';

/**
 * Public webchat page. `?embed=1` renders the compact chrome used inside the embeddable widget
 * iframe (see /embed.js). Session tokens are per tab and never grant staff data.
 */
export default function WebchatPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const embed = params.get('embed') === '1';
  const t = useT();
  const w = useWebchat(slug);

  if (w.profile.isError) return <EmptyState title={t('errors.notFound')} body={t('errors.notFoundBody')} className="min-h-dvh" />;

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {/* In the embed iframe the host page's close button floats over the top-right corner on phones. */}
      <header className={cn('flex items-center gap-3 border-b border-border bg-surface px-4 py-3', embed && 'max-sm:pr-16')}>
        <AgentAvatar size={embed ? 34 : 40} online />
        <div className="min-w-0 flex-1">
          {w.profile.isLoading ? <Skeleton className="h-4 w-40" /> : <p className="truncate font-semibold">{w.profile.data?.agent?.name ?? 'Alejandro AI'}</p>}
          <p className="truncate text-xs text-ink-3">{w.profile.data?.clinic.name}</p>
        </div>
        <LangSwitch compact />
        {!embed && <A11yButton />}
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <WebchatPanel w={w} />
      </main>
    </div>
  );
}
