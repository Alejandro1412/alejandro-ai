import type { ReactNode } from 'react';
import { HiOutlineCalendarDays, HiOutlineBookOpen, HiOutlineUserGroup } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { AgentAvatar, Logo } from '@/components/brand/Logo';
import { useT } from '@/contexts/PreferencesContext';
import { AuroraCanvas } from '@/lib/motion/AuroraCanvas';
import { A11yButton, LangSwitch, ThemeMenu } from '@/layouts/Controls';

export function AuthLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const pitch = [
    { icon: HiOutlineCalendarDays, text: t('auth.sidePitch1') },
    { icon: HiOutlineBookOpen, text: t('auth.sidePitch2') },
    { icon: HiOutlineUserGroup, text: t('auth.sidePitch3') },
  ];
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="Alejandro AI" data-no-underline>
            <Logo />
          </Link>
          <div className="flex items-center">
            <LangSwitch />
            <ThemeMenu />
            <A11yButton />
          </div>
        </div>
        <main id="main" className="page-enter mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
        </main>
      </div>
      <aside className="relative isolate hidden overflow-hidden bg-[#060a17] lg:block" aria-hidden="true">
        <AuroraCanvas className="-z-10" intensity={0.9} />
        <div className="bg-grid absolute inset-0 -z-10 opacity-[0.07]" />
        <div className="stagger relative flex h-full flex-col justify-center px-14 text-white">
          <h2 className="max-w-md text-3xl font-bold leading-tight text-balance">{t('auth.sidePitchTitle')}</h2>
          <ul className="mt-8 space-y-4">
            {pitch.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-[0.95rem] text-white/80">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-lg text-accent">
                  <p.icon />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-12 max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <AgentAvatar size={36} online />
              <div>
                <p className="text-sm font-semibold">Alejandro AI</p>
                <p className="text-xs text-white/60">{t('brand.tagline')}</p>
              </div>
            </div>
            <p className="mt-3 rounded-xl rounded-tl-sm bg-white/10 px-3 py-2 text-sm text-white/90">{t('landing.mockChatAi')}</p>
            <div className="mt-2 flex gap-2">
              {['9:00', '10:30', '15:00'].map((h) => (
                <span key={h} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold">
                  {h}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
