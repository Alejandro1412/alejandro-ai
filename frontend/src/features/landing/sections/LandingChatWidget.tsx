import { useEffect, useRef, useState } from 'react';
import { HiOutlineChatBubbleOvalLeftEllipsis, HiXMark } from 'react-icons/hi2';
import { AgentAvatar } from '@/components/brand/Logo';
import { useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import { useWebchat } from '@/features/webchat/useWebchat';
import { WebchatPanel } from '@/features/webchat/WebchatPanel';

const DEMO_SLUG = (import.meta.env.VITE_DEMO_CLINIC_SLUG as string | undefined) || 'novacare';
export const OPEN_CHAT_EVENT = 'aai:open-chat';

/** Lets any CTA on the page open the live demo chat. */
export const openLandingChat = () => window.dispatchEvent(new Event(OPEN_CHAT_EVENT));

/**
 * Floating live chat on the landing page, talking to the real agent of the demo clinic through the
 * public webchat API. The session is created only when a visitor opens it.
 */
export function LandingChatWidget() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const w = useWebchat(DEMO_SLUG, everOpened);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      setEverOpened(true);
      setTeaser(false);
    };
    window.addEventListener(OPEN_CHAT_EVENT, show);
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('aai.teaser') === '1';
    } catch {
      /* ignore */
    }
    const timer = dismissed ? undefined : window.setTimeout(() => setTeaser(true), 7000);
    return () => {
      window.removeEventListener(OPEN_CHAT_EVENT, show);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 350);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
    };
  }, [open, w.ready]);

  const dismissTeaser = () => {
    setTeaser(false);
    try {
      sessionStorage.setItem('aai.teaser', '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {teaser && !open && (
        <div className="fixed bottom-24 right-4 z-[55] w-[min(300px,calc(100vw-2rem))] animate-slide-up rounded-2xl border border-border bg-surface p-4 pr-9 text-sm text-ink shadow-pop sm:right-6">
          <button type="button" onClick={dismissTeaser} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label={t('landing.dismiss')}>
            <HiXMark aria-hidden="true" />
          </button>
          <button type="button" className="text-left" onClick={() => window.dispatchEvent(new Event(OPEN_CHAT_EVENT))}>
            {t('landing.chatTeaser')}
          </button>
        </div>
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={t('landing.chatLauncher')}
        hidden={!open}
        data-lenis-prevent
        className={cn(
          // `hidden` attribute alone loses to the `flex` utility, so hide with a class too.
          !open && 'hidden',
          'fixed z-[56] flex-col overflow-hidden border border-border bg-bg shadow-[0_30px_90px_-20px_rgba(15,23,42,.45)]',
          'inset-0 sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(640px,calc(100dvh-8rem))] sm:w-[400px] sm:rounded-3xl',
          open && 'flex animate-slide-up',
        )}
      >
        <header className="flex items-center gap-3 bg-gradient-to-r from-[#060a17] to-[#1e1b4b] px-4 py-3 text-white">
          <AgentAvatar size={38} online />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Alejandro AI</p>
            <p className="truncate text-xs text-white/65">{t('landing.chatDemoBadge')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              launcherRef.current?.focus();
            }}
            className="grid h-9 w-9 place-items-center rounded-xl text-white/80 hover:bg-white/10"
            aria-label={t('landing.closeChat')}
          >
            <HiXMark className="text-xl" aria-hidden="true" />
          </button>
        </header>
        {everOpened && <WebchatPanel w={w} />}
      </div>

      <button
        ref={launcherRef}
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setEverOpened(true);
          dismissTeaser();
        }}
        className={cn(
          'group fixed bottom-4 right-4 z-[57] flex items-center gap-2.5 rounded-full bg-gradient-to-r from-primary to-[#7c3aed] py-2 pl-2 text-white shadow-[0_12px_40px_-8px_rgba(79,70,229,.8)] transition hover:scale-[1.03] sm:bottom-6 sm:right-6',
          open ? 'pr-2 max-sm:hidden' : 'pr-4',
        )}
      >
        <span className="relative grid h-10 w-10 place-items-center rounded-full bg-white/15">
          {open ? <HiXMark className="text-xl" aria-hidden="true" /> : <HiOutlineChatBubbleOvalLeftEllipsis className="text-xl" aria-hidden="true" />}
          {!open && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#5b4be8] bg-accent" aria-hidden="true" />}
        </span>
        {!open && <span className="text-sm font-semibold">{t('landing.chatLauncher')}</span>}
        {open && <span className="sr-only">{t('landing.closeChat')}</span>}
      </button>
    </>
  );
}
