import { NavLink, Outlet } from 'react-router-dom';
import { HiOutlineAdjustmentsHorizontal, HiOutlineBuildingOffice2, HiOutlineCreditCard, HiOutlineDocumentMagnifyingGlass, HiOutlineLockClosed, HiOutlinePuzzlePiece, HiOutlineSparkles, HiOutlineUsers } from 'react-icons/hi2';
import { MdOutlineAccessibilityNew } from 'react-icons/md';
import { PageHeader } from '@/components/ui/Display';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';

const ITEMS: { to: string; label: TKey; icon: typeof HiOutlineSparkles; perm?: string }[] = [
  { to: 'clinic', label: 'settings.clinic', icon: HiOutlineBuildingOffice2 },
  { to: 'ai', label: 'settings.ai', icon: HiOutlineSparkles, perm: 'settings.manage' },
  { to: 'integrations', label: 'settings.integrations', icon: HiOutlinePuzzlePiece, perm: 'integrations.manage' },
  { to: 'team', label: 'settings.team', icon: HiOutlineUsers, perm: 'team.manage' },
  { to: 'billing', label: 'settings.billing', icon: HiOutlineCreditCard, perm: 'billing.manage' },
  { to: 'security', label: 'settings.security', icon: HiOutlineLockClosed },
  { to: 'audit', label: 'settings.audit', icon: HiOutlineDocumentMagnifyingGlass, perm: 'audit.read' },
  { to: 'accessibility', label: 'settings.accessibility', icon: MdOutlineAccessibilityNew },
];

export default function SettingsLayout() {
  const t = useT();
  const { can } = useAuth();
  const items = ITEMS.filter((i) => !i.perm || can(i.perm));
  return (
    <div>
      <PageHeader title={t('settings.title')} eyebrow={<HiOutlineAdjustmentsHorizontal className="mb-2 text-2xl text-ink-3" aria-hidden="true" />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('settings.title')} className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) => cn('flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition', isActive ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
              data-no-underline
            >
              <i.icon className="text-lg" aria-hidden="true" />
              {t(i.label)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 space-y-5">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
