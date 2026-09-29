import { AgentAvatar } from '@/components/brand/Logo';
import { usePreferences, useT } from '@/contexts/PreferencesContext';

/** Static, decorative rendering of the product used in marketing sections (hidden from assistive tech). */
export function ProductMock() {
  const t = useT();
  const { prefs } = usePreferences();
  return (
    <div className="relative mx-auto w-full max-w-5xl" aria-hidden="true">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-[0_40px_120px_-20px_rgba(79,70,229,.55),0_0_0_1px_rgba(255,255,255,.04)]">
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 rounded-md bg-surface px-3 py-0.5 text-[0.68rem] text-ink-3">app.alejandro.ai/dashboard</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-3 p-4 sm:p-5">
            <p className="text-sm font-bold">{t('dashboard.greetingMorning', { name: 'Laura' })}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [t('dashboard.todayAppointments'), '84'],
                [t('dashboard.aiConversations'), '237'],
                [t('dashboard.bookedByAi'), '31'],
                [t('dashboard.resolution'), '91%'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border p-2.5">
                  <p className="truncate text-[0.62rem] text-ink-3">{k}</p>
                  <p className="font-display text-xl font-bold">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="mb-2 text-[0.68rem] font-semibold text-ink-2">{t('dashboard.conversationsOverTime')}</p>
              <svg viewBox="0 0 300 80" className="h-20 w-full">
                <path d="M0 60 C 30 50, 50 55, 75 42 S 120 30, 150 34 S 200 18, 225 22 S 270 10, 300 12" fill="none" stroke="var(--chart-1)" strokeWidth="2.5" />
                <path d="M0 70 C 30 64, 50 66, 75 56 S 120 48, 150 50 S 200 38, 225 40 S 270 30, 300 30" fill="none" stroke="var(--chart-2)" strokeWidth="2.5" />
              </svg>
            </div>
            <div className="hidden space-y-1.5 sm:block">
              {[
                ['08:00', 'María Rodríguez', 'Dra. María García', '#7c3aed'],
                ['09:20', 'Andrés Gómez', 'Dr. Carlos Pérez', '#e11d48'],
                ['10:40', 'Laura Ospina', 'Dr. Juan Rodríguez', '#0891b2'],
              ].map(([h, p, d, c]) => (
                <div key={h} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[0.7rem] hover:bg-surface-2">
                  <span className="w-10 font-bold">{h}</span>
                  <span className="h-5 w-1 rounded-full" style={{ background: c }} />
                  <span className="flex-1 truncate">{p}</span>
                  <span className="truncate text-ink-3">{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col border-t border-border bg-surface-2 md:border-l md:border-t-0">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <AgentAvatar size={26} online />
              <span className="text-xs font-semibold">Alejandro AI</span>
            </div>
            <div className="flex-1 space-y-2.5 p-4 text-[0.72rem]">
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-fg">{t('landing.mockChatUser')}</p>
              <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2">{t('landing.mockChatAi')}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(prefs.lang === 'en' ? ['Thu 10:30', 'Fri 8:00', 'Fri 15:00'] : ['Jue 10:30', 'Vie 8:00', 'Vie 15:00']).map((s) => (
                  <span key={s} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-center font-semibold">
                    {s}
                  </span>
                ))}
              </div>
              <div className="space-y-1 rounded-xl border border-dashed border-border-strong p-2 font-mono text-[0.62rem] text-ink-3">
                <p>⚙ getDoctors(specialty: "dermatología")</p>
                <p>⚙ getAvailableAppointmentSlots(…)</p>
                <p className="text-success">✓ createAppointment → CONFIRMED</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
