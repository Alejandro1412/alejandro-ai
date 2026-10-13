import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { AppLayout } from '@/layouts/AppLayout';
import { FullScreenLoader, PageLoader } from '@/layouts/PageLoader';
import { EmptyState } from '@/components/ui/Feedback';

const Landing = lazy(() => import('@/features/landing/LandingPage'));
const Login = lazy(() => import('@/features/auth/LoginPage'));
const Register = lazy(() => import('@/features/auth/RegisterPage'));
const PatientRegister = lazy(() => import('@/features/auth/PatientRegisterPage'));
const Webchat = lazy(() => import('@/features/webchat/WebchatPage'));
const Onboarding = lazy(() => import('@/features/onboarding/OnboardingPage'));
const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'));
const AiOverview = lazy(() => import('@/features/ai/AiOverviewPage'));
const Playground = lazy(() => import('@/features/ai/PlaygroundPage'));
const Conversations = lazy(() => import('@/features/conversations/ConversationsPage'));
const ConversationDetail = lazy(() => import('@/features/conversations/ConversationDetailPage'));
const Appointments = lazy(() => import('@/features/appointments/AppointmentsPage'));
const AppointmentDetail = lazy(() => import('@/features/appointments/AppointmentDetailPage'));
const Calendar = lazy(() => import('@/features/calendar/CalendarPage'));
const Doctors = lazy(() => import('@/features/doctors/DoctorsPage'));
const DoctorDetail = lazy(() => import('@/features/doctors/DoctorDetailPage'));
const Patients = lazy(() => import('@/features/patients/PatientsPage'));
const PatientDetail = lazy(() => import('@/features/patients/PatientDetailPage'));
const Knowledge = lazy(() => import('@/features/knowledge/KnowledgePage'));
const KnowledgeDetail = lazy(() => import('@/features/knowledge/KnowledgeDetailPage'));
const Analytics = lazy(() => import('@/features/analytics/AnalyticsPage'));
const Notifications = lazy(() => import('@/features/notifications/NotificationsPage'));
const SettingsLayout = lazy(() => import('@/features/settings/SettingsLayout'));
const ClinicSettings = lazy(() => import('@/features/settings/ClinicSettings'));
const AiSettings = lazy(() => import('@/features/settings/AiSettings'));
const IntegrationsSettings = lazy(() => import('@/features/settings/IntegrationsSettings'));
const TeamSettings = lazy(() => import('@/features/settings/TeamSettings'));
const SecuritySettings = lazy(() => import('@/features/settings/SecuritySettings'));
const BillingSettings = lazy(() => import('@/features/settings/BillingSettings'));
const AccessibilitySettings = lazy(() => import('@/features/settings/AccessibilitySettings'));
const AuditSettings = lazy(() => import('@/features/settings/AuditSettings'));
const PortalLayout = lazy(() => import('@/features/portal/PortalLayout'));
const PortalHome = lazy(() => import('@/features/portal/PortalHome'));
const PortalAppointments = lazy(() => import('@/features/portal/PortalAppointments'));
const PortalBook = lazy(() => import('@/features/portal/PortalBook'));
const PortalChat = lazy(() => import('@/features/portal/PortalChat'));
const PortalProfile = lazy(() => import('@/features/portal/PortalProfile'));
const NotFound = lazy(() => import('@/features/misc/NotFoundPage'));
const ActionPage = lazy(() => import('@/features/actions/ActionPage'));
const LegalPage = lazy(() => import('@/features/legal/LegalPage'));
const Waitlist = lazy(() => import('@/features/waitlist/WaitlistPage'));
const Growth = lazy(() => import('@/features/growth/GrowthPage'));
const ValueReport = lazy(() => import('@/features/reports/ValueReportPage'));
const AdminConsole = lazy(() => import('@/features/admin/AdminPage'));
const Impersonate = lazy(() => import('@/features/admin/ImpersonatePage'));

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>;

function RequireAuth({ area }: { area: 'staff' | 'patient' }) {
  const { status, me } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  const isPatient = me?.role === 'PATIENT';
  if (area === 'staff' && isPatient) return <Navigate to="/portal" replace />;
  if (area === 'patient' && !isPatient) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') return <Navigate to={me?.role === 'PATIENT' ? '/portal' : '/dashboard'} replace />;
  return <>{children}</>;
}

/** Frontend gating is UX only — the backend enforces the same permissions. */
function Perm({ p, children }: { p: string; children: ReactNode }) {
  const { can } = useAuth();
  const t = useT();
  if (!can(p)) return <EmptyState title={t('errors.forbidden')} />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  { path: '/', element: <S><Landing /></S> },
  { path: '/pricing', element: <Navigate to="/#pricing" replace /> },
  { path: '/login', element: <S><RedirectIfAuthed><Login /></RedirectIfAuthed></S> },
  { path: '/register', element: <S><RedirectIfAuthed><Register /></RedirectIfAuthed></S> },
  { path: '/patient/register', element: <S><RedirectIfAuthed><PatientRegister /></RedirectIfAuthed></S> },
  { path: '/c/:slug', element: <S><Webchat /></S> },
  { path: '/a/:token', element: <S><ActionPage /></S> },
  { path: '/legal/:doc', element: <S><LegalPage /></S> },
  { path: '/impersonate', element: <S><Impersonate /></S> },
  {
    element: <RequireAuth area="staff" />,
    children: [
      { path: '/onboarding', element: <S><Onboarding /></S> },
      {
        element: <AppLayout />,
        children: [
          { path: '/dashboard', element: <Dashboard /> },
          { path: '/ai', element: <Perm p="ai.playground"><AiOverview /></Perm> },
          { path: '/ai/playground', element: <Perm p="ai.playground"><Playground /></Perm> },
          { path: '/conversations', element: <Perm p="conversations.read"><Conversations /></Perm> },
          { path: '/conversations/:id', element: <Perm p="conversations.read"><ConversationDetail /></Perm> },
          { path: '/appointments', element: <Perm p="appointments.read"><Appointments /></Perm> },
          { path: '/appointments/:id', element: <Perm p="appointments.read"><AppointmentDetail /></Perm> },
          { path: '/calendar', element: <Perm p="appointments.read"><Calendar /></Perm> },
          { path: '/doctors', element: <Perm p="doctors.read"><Doctors /></Perm> },
          { path: '/doctors/:id', element: <Perm p="doctors.read"><DoctorDetail /></Perm> },
          { path: '/patients', element: <Perm p="patients.read"><Patients /></Perm> },
          { path: '/patients/:id', element: <Perm p="patients.read"><PatientDetail /></Perm> },
          { path: '/knowledge', element: <Perm p="knowledge.read"><Knowledge /></Perm> },
          { path: '/knowledge/:id', element: <Perm p="knowledge.read"><KnowledgeDetail /></Perm> },
          { path: '/analytics', element: <Perm p="analytics.read"><Analytics /></Perm> },
          { path: '/waitlist', element: <Perm p="appointments.read"><Waitlist /></Perm> },
          { path: '/growth', element: <Perm p="analytics.read"><Growth /></Perm> },
          { path: '/reports/value', element: <Perm p="analytics.read"><ValueReport /></Perm> },
          { path: '/admin', element: <Perm p="platform.admin"><AdminConsole /></Perm> },
          { path: '/notifications', element: <Notifications /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/clinic" replace /> },
              { path: 'clinic', element: <ClinicSettings /> },
              { path: 'ai', element: <Perm p="settings.manage"><AiSettings /></Perm> },
              { path: 'integrations', element: <Perm p="integrations.manage"><IntegrationsSettings /></Perm> },
              { path: 'team', element: <Perm p="team.manage"><TeamSettings /></Perm> },
              { path: 'security', element: <SecuritySettings /> },
              { path: 'billing', element: <Perm p="billing.manage"><BillingSettings /></Perm> },
              { path: 'accessibility', element: <AccessibilitySettings /> },
              { path: 'audit', element: <Perm p="audit.read"><AuditSettings /></Perm> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth area="patient" />,
    children: [
      {
        path: '/portal',
        element: <S><PortalLayout /></S>,
        children: [
          { index: true, element: <PortalHome /> },
          { path: 'appointments', element: <PortalAppointments /> },
          { path: 'book', element: <PortalBook /> },
          { path: 'chat', element: <PortalChat /> },
          { path: 'profile', element: <PortalProfile /> },
        ],
      },
    ],
  },
  { path: '*', element: <S><NotFound /></S> },
]);

export function Passthrough() {
  return <Outlet />;
}
