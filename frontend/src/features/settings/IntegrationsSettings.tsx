import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FaGoogle, FaWhatsapp } from 'react-icons/fa6';
import { HiOutlineCalendarDays, HiOutlineChatBubbleOvalLeft, HiOutlineClipboard, HiOutlineEnvelope } from 'react-icons/hi2';
import { AgentAvatar } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtRelative } from '@/lib/format';

interface CalendarList {
  integrations: { id: string; provider: string; status: string; doctorId: string | null; accountEmail: string | null; error: string | null; connectedAt: string }[];
  googleConfigured: boolean;
}
interface WaStatus {
  provider: 'mock' | 'meta';
  connected: boolean;
  phoneNumberId: string | null;
  signatureValidation: boolean;
  webhookUrl: string;
  planAllowsWhatsapp: boolean;
  outbox: { to: string; body: string; at: string }[];
}

export default function IntegrationsSettings() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const cal = useQuery({ queryKey: ['calendar', 'integrations'], queryFn: () => api.get<CalendarList>('/calendars/integrations') });
  const wa = useQuery({ queryKey: ['integrations', 'whatsapp'], queryFn: () => api.get<WaStatus>('/integrations/whatsapp') });
  const deliveries = useQuery({ queryKey: ['integrations', 'deliveries'], queryFn: () => api.get<{ providers: Record<string, string>; deliveries: { id: string; type: string; channel: string; recipient: string; status: string; createdAt: string }[] }>('/notifications/deliveries') });
  const [from, setFrom] = useState('+573001234567');
  const [text, setText] = useState('Hola, ¿qué horarios tienen para dermatología?');
  const [reply, setReply] = useState<string | null>(null);

  const refreshCal = () => void qc.invalidateQueries({ queryKey: ['calendar'] });
  const connect = useMutation({ mutationFn: (provider: 'MOCK' | 'INTERNAL') => api.post('/calendars/connect', { provider, doctorId: null }), onSuccess: refreshCal, onError: (e) => toast.error(errorMessage(e)) });
  const google = useMutation({ mutationFn: () => api.post<{ url: string }>('/calendars/google/auth-url', { doctorId: null }), onSuccess: (r) => (window.location.href = r.url), onError: (e) => toast.error(errorMessage(e)) });
  const disconnect = useMutation({ mutationFn: (id: string) => api.delete(`/calendars/integrations/${id}`), onSuccess: refreshCal });
  const simulate = useMutation({
    mutationFn: () => api.post<{ reply: string | null }>('/integrations/whatsapp/simulate', { from, text }),
    onSuccess: (r) => {
      setReply(r.reply);
      void qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const connected = cal.data?.integrations.filter((i) => i.status === 'CONNECTED') ?? [];
  const webchatUrl = `${window.location.origin}/c/${me?.clinic.slug ?? ''}`;

  return (
    <>
      <Card>
        <CardHeader title={t('settings.calendar')} subtitle={t('settings.calendarBody')} icon={<HiOutlineCalendarDays />} />
        <div className="space-y-3 px-5 pb-5">
          {connected.length === 0 && <EmptyState icon={<HiOutlineCalendarDays />} title={t('empty.calendarNotConnected')} body={t('calendar.notConnectedBody')} className="py-6" />}
          {connected.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
              <Badge tone="success" dot>
                {t('settings.connected')}
              </Badge>
              <span className="font-medium">{i.provider}</span>
              <span className="text-sm text-ink-3">{i.accountEmail}</span>
              {i.error && <span className="text-xs text-danger">{i.error}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => disconnect.mutate(i.id)}>
                {t('settings.disconnect')}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<FaGoogle aria-hidden="true" />} disabled={!cal.data?.googleConfigured} loading={google.isPending} onClick={() => google.mutate()} title={!cal.data?.googleConfigured ? 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET' : undefined}>
              {t('settings.connectGoogle')}
            </Button>
            <Button variant="ghost" onClick={() => connect.mutate('MOCK')}>
              {t('settings.connectMock')}
            </Button>
            <Button variant="ghost" onClick={() => connect.mutate('INTERNAL')}>
              {t('settings.connectInternal')}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t('settings.whatsapp')}
          subtitle={t('settings.whatsappBody')}
          icon={<FaWhatsapp />}
          action={wa.data && <Badge tone={wa.data.connected ? 'success' : 'warning'} dot>{wa.data.connected ? t('settings.liveMode') : t('settings.mockMode')}</Badge>}
        />
        {wa.data && (
          <div className="space-y-4 px-5 pb-5">
            {!wa.data.connected && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-ink">{t('empty.whatsappBody')}</p>}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-3">{t('settings.webhookUrl')}</dt>
                <dd className="flex items-center gap-2 font-mono text-xs">
                  <span className="truncate">{wa.data.webhookUrl}</span>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(wa.data!.webhookUrl).then(() => toast.success(t('common.copied')))} aria-label={t('common.copy')} className="rounded p-1 text-ink-3 hover:text-ink">
                    <HiOutlineClipboard aria-hidden="true" />
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">{t('settings.signature')}</dt>
                <dd>
                  <Badge tone={wa.data.signatureValidation ? 'success' : 'neutral'}>{wa.data.signatureValidation ? 'X-Hub-Signature-256' : t('common.disabled')}</Badge>
                </dd>
              </div>
            </dl>
            <form
              className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                simulate.mutate();
              }}
            >
              <p className="text-sm font-semibold">{t('settings.simulate')}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
                <Field label={t('settings.simulateFrom')}>
                  <Input value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label={t('settings.simulateText')}>
                  <Input value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
                <Button type="submit" loading={simulate.isPending} icon={<FaWhatsapp aria-hidden="true" />}>
                  {t('chat.send')}
                </Button>
              </div>
              {reply && (
                <div className="flex items-start gap-2" aria-live="polite">
                  <AgentAvatar size={28} />
                  <p className="whitespace-pre-line rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3 py-2 text-sm text-[#111] dark:bg-[#1f3a2c] dark:text-white">{reply}</p>
                </div>
              )}
            </form>
            {wa.data.outbox.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{t('settings.outbox')}</p>
                <ul className="scrollbar-thin max-h-56 space-y-2 overflow-y-auto">
                  {wa.data.outbox.map((m, i) => (
                    <li key={i} className="rounded-xl border border-border p-2.5 text-xs">
                      <p className="font-mono text-ink-3">
                        → {m.to} · {fmtRelative(m.at, prefs.lang)}
                      </p>
                      <p className="mt-1 line-clamp-3 whitespace-pre-line text-ink-2">{m.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={t('settings.webchat')} subtitle={t('settings.webchatBody')} icon={<HiOutlineChatBubbleOvalLeft />} />
        <div className="space-y-3 px-5 pb-5">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2.5">
            <code className="min-w-0 flex-1 truncate text-sm">{webchatUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(webchatUrl).then(() => toast.success(t('common.copied')))}>
              {t('common.copy')}
            </Button>
            <a href={webchatUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">
              {t('common.open')}
            </a>
          </div>
          <pre className="scrollbar-thin overflow-x-auto rounded-xl bg-surface-3 p-3 text-xs text-ink-2">{`<iframe src="${webchatUrl}" title="Alejandro AI" style="width:400px;height:640px;border:0;border-radius:16px"></iframe>`}</pre>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.notificationsProviders')} icon={<HiOutlineEnvelope />} />
        <div className="px-5 pb-5">
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(deliveries.data?.providers ?? {}).map(([k, v]) => (
              <Badge key={k} tone={v.startsWith('mock') ? 'warning' : 'success'}>
                {k}: {v}
              </Badge>
            ))}
          </div>
          <ul className="divide-y divide-border text-sm">
            {deliveries.data?.deliveries.slice(0, 8).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <Badge>{d.channel}</Badge>
                <span className="text-ink-2">{d.type}</span>
                <span className="font-mono text-xs text-ink-3">{d.recipient}</span>
                <Badge tone={statusTone(d.status === 'SENT' ? 'SUCCESS' : d.status === 'FAILED' ? 'ERROR' : 'PENDING')} className="ml-auto">
                  {d.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
