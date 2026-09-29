import { Suspense } from 'react';
import { HiOutlineArrowRightOnRectangle, HiOutlineCalendarDays, HiOutlineChatBubbleOvalLeft, HiOutlineHome, HiOutlinePlusCircle, HiOutlineUser } from 'react-icons/hi2';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/contexts/PreferencesContext';
import { A11yButton, LangSwitch, ThemeMenu } from '@/layouts/Controls';
import { PageLoader } from '@/layouts/PageLoader';
import { cn } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';

const ITEMS: { to: string; label: TKey; icon: typeof HiOutlineHome; end?: boolean }[] = [
  { to: '/portal', label: 'nav.portalHome', icon: HiOutlineHome, end: true },
  { to: '/portal/appointments', label: 'nav.portalAppointments', icon: HiOutlineCalendarDays },
  { to: '/portal/book', label: 'nav.portalBook', icon: HiOutlinePlusCircle },
  { to: '/portal/chat', label: 'nav.portalChat', icon: HiOutlineChatBubbleOvalLeft },
  { to: '/portal/profile', label: 'nav.portalProfile', icon: HiOutlineUser },
];

/** Patient portal: mobile-app feel with a bottom tab bar; centered column on desktop. */
export default function PortalLayout() {
  const t = useT();
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useRealtime(Boolean(me));
  return (
    <div className="min-h-dvh bg-bg">
      <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t('common.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-4">
          <NavLink to="/portal" aria-label="Alejandro AI" data-no-underline>
            <Logo size={30} />
          </NavLink>
          <span className="hidden truncate text-sm text-ink-3 sm:inline">· {me?.clinic.name}</span>
          <nav aria-label={t('nav.menu')} className="ml-6 hidden items-center gap-1 lg:flex">
            {ITEMS.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2')} data-no-underline>
                {t(i.label)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center">
            <LangSwitch compact />
            <ThemeMenu />
            <A11yButton />
            <button type="button" onClick={() => void logout().then(() => nav('/login'))} className="grid h-10 w-10 place-items-center rounded-xl text-lg text-ink-2 hover:bg-surface-2" aria-label={t('common.logout')} title={t('common.logout')}>
              <HiOutlineArrowRightOnRectangle aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 pb-28 pt-6 lg:pb-12">
        <Suspense fallback={<PageLoader />}>
          <div key={loc.pathname} className="page-enter">
            <Outlet />
          </div>
        </Suspense>
      </main>
      <nav aria-label={t('nav.menu')} className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden">
        <ul className="grid grid-cols-5">
          {ITEMS.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.end} className={({ isActive }) => cn('flex min-h-[60px] flex-col items-center justify-center gap-1 text-[0.66rem] font-medium', isActive ? 'text-primary' : 'text-ink-3')} data-no-underline>
                <i.icon className="text-[1.35rem]" aria-hidden="true" />
                <span className="max-w-full truncate px-0.5">{t(i.label)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
