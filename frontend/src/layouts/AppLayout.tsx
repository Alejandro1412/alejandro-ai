import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useState } from 'react';
import { HiBars3, HiMagnifyingGlass, HiOutlineArrowRightOnRectangle, HiOutlineBell, HiOutlineEllipsisHorizontal, HiOutlineUserCircle } from 'react-icons/hi2';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Logo, Isotype } from '@/components/brand/Logo';
import { Avatar, Badge, Kbd } from '@/components/ui/Display';
import { Drawer } from '@/components/ui/Overlay';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { NAV, type NavItem } from '@/config/nav';
import { AccountBanners } from '@/features/admin/AccountBanners';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';
import { A11yButton, LangSwitch, ThemeMenu } from './Controls';
import { CommandPalette } from './CommandPalette';
import { PageLoader } from './PageLoader';

function useNavItems() {
  const { can } = useAuth();
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) })).filter((g) => g.items.length);
}

function SideLink({ item, collapsed, onClick }: { item: NavItem; collapsed?: boolean; onClick?: () => void }) {
  const t = useT();
  return (
    <NavLink
      to={item.to}
      end={item.to === '/ai' || item.to === '/dashboard'}
      onClick={onClick}
      title={collapsed ? t(item.label) : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-xl px-3 py-2 text-[0.92rem] font-medium transition',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )
      }
    >
      <item.icon className="shrink-0 text-[1.2rem]" aria-hidden="true" />
      <span className={cn(collapsed && 'sr-only')}>{t(item.label)}</span>
    </NavLink>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const t = useT();
  const groups = useNavItems();
  return (
    <nav aria-label={t('nav.menu')} className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <p className={cn('mb-1.5 px-3 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-3', collapsed && 'sr-only')}>{t(g.label)}</p>
          <div className="space-y-0.5">
            {g.items.map((i) => (
              <SideLink key={i.to} item={i} collapsed={collapsed} onClick={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function PlanPill() {
  const { me } = useAuth();
  const t = useT();
  if (!me?.subscription) return null;
  return (
    <NavLink to="/settings/billing" className="block rounded-xl border border-border bg-surface-2 p-3 text-xs hover:border-border-strong">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink">{me.subscription.planName}</span>
        <Badge tone={me.subscription.status === 'TRIALING' ? 'accent' : 'success'}>{t(`status.${me.subscription.status}` as never)}</Badge>
      </div>
      <p className="mt-1 truncate text-ink-3">{me.clinic.name}</p>
    </NavLink>
  );
}

export function AppLayout() {
  const t = useT();
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const groups = useNavItems();
  const mobileItems = groups.flatMap((g) => g.items).filter((i) => i.mobile).slice(0, 4);

  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'), refetchInterval: 60_000 });

  const onEvent = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      if (event === 'handoff.created') toast.info(t('chat.handoff'), `${t('chat.urgency')}: ${t(`urgency.${String(payload.urgency)}` as never)}`);
    },
    [toast, t],
  );
  useRealtime(Boolean(me), onEvent);

  return (
    <div className="min-h-dvh bg-bg">
      <a href="#main" className="sr-only z-[70] rounded-lg bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t('common.skipToContent')}
      </a>

      {/* Desktop sidebar (xl) and icon rail (md–lg) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col border-r border-border bg-surface md:flex xl:w-64">
        <div className="flex h-16 items-center px-4 xl:px-5">
          <NavLink to="/dashboard" aria-label="Alejandro AI" data-no-underline>
            <span className="xl:hidden">
              <Isotype size={36} />
            </span>
            <span className="hidden xl:inline">
              <Logo showSub />
            </span>
          </NavLink>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4 xl:hidden">
          <SidebarNav collapsed />
        </div>
        <div className="scrollbar-thin hidden flex-1 overflow-y-auto px-3 py-4 xl:block">
          <SidebarNav />
        </div>
        <div className="hidden p-3 xl:block">
          <PlanPill />
        </div>
      </aside>

      <div className="md:pl-[76px] xl:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-md sm:px-5">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-xl text-xl text-ink-2 hover:bg-surface-2 md:hidden" onClick={() => setDrawer(true)} aria-label={t('common.openMenu')}>
            <HiBars3 aria-hidden="true" />
          </button>
          <NavLink to="/dashboard" className="md:hidden" aria-label="Alejandro AI" data-no-underline>
            <Logo size={28} />
          </NavLink>
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="ml-auto hidden h-10 w-full max-w-sm items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-ink-3 hover:border-border-strong sm:flex md:ml-0"
          >
            <HiMagnifyingGlass aria-hidden="true" />
            <span className="flex-1 text-left">{t('common.commandHint')}</span>
            <Kbd>⌘K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-0.5">
            <button type="button" onClick={() => setPalette(true)} className="grid h-10 w-10 place-items-center rounded-xl text-lg text-ink-2 hover:bg-surface-2 sm:hidden" aria-label={t('common.search')}>
              <HiMagnifyingGlass aria-hidden="true" />
            </button>
            <span className="hidden sm:flex">
              <LangSwitch />
            </span>
            <span className="hidden sm:flex">
              <ThemeMenu />
            </span>
            <A11yButton />
            <NavLink to="/notifications" className="relative grid h-10 w-10 place-items-center rounded-xl text-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={`${t('nav.notifications')}${unread.data?.unread ? ` (${unread.data.unread})` : ''}`} data-no-underline>
              <HiOutlineBell aria-hidden="true" />
              {Boolean(unread.data?.unread) && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.6rem] font-bold text-white">{unread.data!.unread > 9 ? '9+' : unread.data!.unread}</span>}
            </NavLink>
            <Menu as="div" className="relative ml-1">
              <MenuButton className="flex items-center gap-2 rounded-xl p-1 hover:bg-surface-2" aria-label={me?.user.name}>
                <Avatar name={me?.user.name ?? '?'} size={34} />
              </MenuButton>
              <MenuItems anchor="bottom end" className="z-50 mt-2 w-60 rounded-xl border border-border bg-surface p-1 shadow-pop focus:outline-none">
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-semibold">{me?.user.name}</p>
                  <p className="truncate text-xs text-ink-3">{me?.user.email}</p>
                  <Badge tone="primary" className="mt-2">
                    {t(`settings.roles.${me?.role ?? 'CLINIC_ADMIN'}` as never)}
                  </Badge>
                </div>
                <div className="my-1 h-px bg-border" />
                <MenuItem>
                  <button type="button" onClick={() => nav('/settings/security')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm data-[focus]:bg-surface-2">
                    <HiOutlineUserCircle aria-hidden="true" /> {t('settings.profile')}
                  </button>
                </MenuItem>
                <MenuItem>
                  <button type="button" onClick={() => void logout().then(() => nav('/login'))} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger data-[focus]:bg-danger-soft">
                    <HiOutlineArrowRightOnRectangle aria-hidden="true" /> {t('common.logout')}
                  </button>
                </MenuItem>
              </MenuItems>
            </Menu>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-6 focus:outline-none sm:px-6 md:pb-10 lg:px-8">
          <AccountBanners />
          <ErrorBoundary key={loc.pathname} title={t('errors.crashTitle')} body={t('errors.crashBody')} reloadLabel={t('errors.reload')} homeLabel={t('errors.goHome')}>
            <Suspense fallback={<PageLoader />}>
              <div key={loc.pathname} className="page-enter">
                <Outlet />
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label={t('nav.menu')} className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-md md:hidden">
        <ul className="grid grid-cols-5">
          {mobileItems.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.to === '/dashboard'} className={({ isActive }) => cn('flex min-h-[60px] flex-col items-center justify-center gap-1 px-0.5 text-[0.64rem] font-medium leading-tight', isActive ? 'text-primary' : 'text-ink-3')} data-no-underline>
                <i.icon className="text-[1.35rem]" aria-hidden="true" />
                <span className="max-w-full truncate">{t(i.label)}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setDrawer(true)} className="flex min-h-[60px] w-full flex-col items-center justify-center gap-1 text-[0.68rem] font-medium text-ink-3">
              <HiOutlineEllipsisHorizontal className="text-[1.35rem]" aria-hidden="true" />
              {t('common.more')}
            </button>
          </li>
        </ul>
      </nav>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Alejandro AI" side="left" width="max-w-xs">
        <div className="flex h-full flex-col">
          <div className="flex-1 p-3">
            <SidebarNav onNavigate={() => setDrawer(false)} />
          </div>
          <div className="space-y-3 border-t border-border p-3">
            <div className="flex items-center gap-1">
              <LangSwitch />
              <ThemeMenu />
            </div>
            <PlanPill />
          </div>
        </div>
      </Drawer>
      <CommandPalette open={palette} setOpen={setPalette} />
    </div>
  );
}
