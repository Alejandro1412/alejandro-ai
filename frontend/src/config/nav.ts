import type { IconType } from 'react-icons';
import {
  HiOutlineBookOpen,
  HiOutlineCalendarDays,
  HiOutlineChartBar,
  HiOutlineChatBubbleLeftRight,
  HiOutlineClipboardDocumentList,
  HiOutlineCog6Tooth,
  HiOutlineHome,
  HiOutlineSparkles,
  HiOutlineUserGroup,
  HiOutlineUsers,
  HiOutlineBeaker,
  HiOutlineQueueList,
  HiOutlineMegaphone,
  HiOutlinePresentationChartLine,
  HiOutlineServerStack,
} from 'react-icons/hi2';
import type { TKey } from '@/contexts/PreferencesContext';

export interface NavItem {
  to: string;
  label: TKey;
  icon: IconType;
  permission?: string;
  /** Shown in the mobile bottom bar. */
  mobile?: boolean;
}

export interface NavGroup {
  label: TKey;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'nav.groupOperations',
    items: [
      { to: '/dashboard', label: 'nav.dashboard', icon: HiOutlineHome, mobile: true },
      { to: '/conversations', label: 'nav.conversations', icon: HiOutlineChatBubbleLeftRight, permission: 'conversations.read', mobile: true },
      { to: '/appointments', label: 'nav.appointments', icon: HiOutlineClipboardDocumentList, permission: 'appointments.read', mobile: true },
      { to: '/calendar', label: 'nav.calendar', icon: HiOutlineCalendarDays, permission: 'appointments.read', mobile: true },
      { to: '/waitlist', label: 'nav.waitlist', icon: HiOutlineQueueList, permission: 'appointments.read' },
    ],
  },
  {
    label: 'nav.groupAi',
    items: [
      { to: '/ai', label: 'nav.ai', icon: HiOutlineSparkles, permission: 'ai.playground' },
      { to: '/ai/playground', label: 'nav.playground', icon: HiOutlineBeaker, permission: 'ai.playground' },
      { to: '/knowledge', label: 'nav.knowledge', icon: HiOutlineBookOpen, permission: 'knowledge.read' },
      { to: '/analytics', label: 'nav.analytics', icon: HiOutlineChartBar, permission: 'analytics.read' },
    ],
  },
  {
    label: 'nav.groupGrowth',
    items: [
      { to: '/reports/value', label: 'nav.valueReport', icon: HiOutlinePresentationChartLine, permission: 'analytics.read' },
      { to: '/growth', label: 'nav.growth', icon: HiOutlineMegaphone, permission: 'analytics.read' },
    ],
  },
  {
    label: 'nav.groupClinic',
    items: [
      { to: '/doctors', label: 'nav.doctors', icon: HiOutlineUserGroup, permission: 'doctors.read' },
      { to: '/patients', label: 'nav.patients', icon: HiOutlineUsers, permission: 'patients.read' },
      { to: '/settings', label: 'nav.settings', icon: HiOutlineCog6Tooth },
      { to: '/admin', label: 'nav.admin', icon: HiOutlineServerStack, permission: 'platform.admin' },
    ],
  },
];
