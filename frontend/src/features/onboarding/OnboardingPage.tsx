import { useMutation, useQuery } from '@tanstack/react-query';
import { HiCheckCircle, HiOutlineArrowRight } from 'react-icons/hi2';
import { Link, useNavigate } from 'react-router-dom';
import { AgentAvatar, Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Display';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { A11yButton, LangSwitch, ThemeMenu } from '@/layouts/Controls';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import type { Clinic, Doctor, KnowledgeSource, Service } from '@/types';

/** Guided setup checklist computed from real data (each step completes itself when the data exists). */
export default function OnboardingPage() {
  const t = useT();
  const nav = useNavigate();
  const { me, reload } = useAuth();
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => api.get<Clinic>('/clinics/current') });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get<Service[]>('/services') });
  const doctors = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get<Doctor[]>('/doctors') });
  const kb = useQuery({ queryKey: ['knowledge', 'list'], queryFn: () => api.page<KnowledgeSource>('/knowledge/documents', { pageSize: 5 }) });
  const finish = useMutation({
    mutationFn: () => api.post('/clinics/current/onboarding/complete'),
    onSuccess: async () => {
      await reload();
      nav('/dashboard', { replace: true });
    },
  });

  const steps = [
    { label: t('onboarding.step1'), done: Boolean(clinic.data?.phone && clinic.data.address), to: '/settings/clinic' },
    { label: t('onboarding.step2'), done: (services.data?.length ?? 0) > 0, to: '/settings/clinic' },
    { label: t('onboarding.step3'), done: (doctors.data?.length ?? 0) > 0 && (doctors.data ?? []).some((d) => d.schedules.length > 0), to: '/doctors' },
    { label: t('onboarding.step4'), done: (kb.data?.meta.total ?? 0) > 0, to: '/knowledge' },
    { label: t('onboarding.step5'), done: true, to: '/settings/ai' },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex h-16 max-w-3xl items-center px-4">
        <Logo />
        <div className="ml-auto flex">
          <LangSwitch />
          <ThemeMenu />
          <A11yButton />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <div className="flex items-center gap-4">
          <AgentAvatar size={56} online />
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{t('onboarding.title')}</h1>
            <p className="mt-1 text-ink-2">{t('onboarding.subtitle')}</p>
          </div>
        </div>
        <p className="mt-6 text-sm font-medium text-ink-2">
          {me?.clinic.name} · {t('onboarding.progress', { done, total: steps.length })}
        </p>
        <div className="mt-2 h-2 rounded-full bg-surface-3" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}>
          <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <Card className="mt-6">
          <ol className="divide-y divide-border">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-4 p-4 sm:p-5">
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold', s.done ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-2')}>{s.done ? <HiCheckCircle className="text-xl" aria-label={t('onboarding.done')} /> : i + 1}</span>
                <span className="flex-1 font-medium">{s.label}</span>
                <Link to={s.to} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                  {s.done ? t('common.edit') : t('onboarding.goTo')} <HiOutlineArrowRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
        <div className="mt-6 flex justify-end">
          <Button size="lg" loading={finish.isPending} onClick={() => finish.mutate()}>
            {t('onboarding.finish')}
          </Button>
        </div>
      </main>
    </div>
  );
}
