import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { HiOutlineClipboard, HiOutlinePhone, HiOutlinePhoneXMark, HiOutlineSpeakerWave } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader } from '@/components/ui/Display';
import { Input, Switch } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';

interface VoiceStatus {
  configured: boolean;
  webhookUrl: string;
  languages: { es: string; en: string };
}
interface SimResult {
  conversationId: string;
  twiml: string;
  say: string;
  planIncludesVoice: boolean;
}
interface Line {
  id: number;
  who: 'agent' | 'caller';
  text: string;
}

const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Phone receptionist: Twilio webhook + an in-browser call simulator (text in, `<Say>` out, optional TTS). */
export function VoiceCard() {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const status = useQuery({ queryKey: ['integrations', 'voice'], queryFn: () => api.get<VoiceStatus>('/integrations/voice/status') });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [ended, setEnded] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [listen, setListen] = useState(false);
  const [planIncludesVoice, setPlanIncludesVoice] = useState<boolean | null>(null);
  const seq = useRef(0);
  const logRef = useRef<HTMLOListElement>(null);
  const canSpeak = speechSupported();

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);
  useEffect(() => () => void (speechSupported() && window.speechSynthesis.cancel()), []);

  const speak = (say: string) => {
    if (!listen || !canSpeak || !say) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(say);
    const voiceLang = status.data?.languages?.[prefs.lang] ?? (prefs.lang === 'en' ? 'en-US' : 'es-CO');
    u.lang = voiceLang;
    window.speechSynthesis.speak(u);
  };

  const add = (who: Line['who'], line: string) => setLines((xs) => [...xs, { id: ++seq.current, who, text: line }]);

  const turn = useMutation({
    mutationFn: (input: string) => api.post<SimResult>('/integrations/voice/simulate', { text: input, ...(conversationId ? { conversationId } : {}) }),
    onSuccess: (r) => {
      setConversationId(r.conversationId);
      setPlanIncludesVoice(r.planIncludesVoice);
      if (r.say) add('agent', r.say);
      speak(r.say);
      if (/<Hangup\s*\/>/.test(r.twiml) && !/<Gather/.test(r.twiml)) {
        setActive(false);
        setEnded(true);
      }
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const start = () => {
    setLines([]);
    setConversationId(null);
    setEnded(false);
    setActive(true);
    turn.mutate('');
  };
  const hangup = () => {
    if (canSpeak) window.speechSynthesis.cancel();
    setActive(false);
    setEnded(false);
    setLines([]);
    setConversationId(null);
    setText('');
  };
  const send = (input: string, display = input) => {
    if (!active || turn.isPending || !input.trim()) return;
    add('caller', display);
    turn.mutate(input.trim());
  };

  const s = status.data;
  const showPlanNote = planIncludesVoice === false;

  return (
    <Card aria-labelledby="voice-h">
      <CardHeader
        id="voice-h"
        title={t('admin.voice.title')}
        subtitle={t('admin.voice.body')}
        icon={<HiOutlinePhone />}
        action={s && <Badge tone={s.configured ? 'success' : 'warning'} dot>{s.configured ? t('admin.voice.configured') : t('admin.voice.notConfigured')}</Badge>}
      />
      <div className="space-y-4 px-5 pb-5">
        {s && (
          <div>
            <p className="text-xs text-ink-3">{t('admin.voice.webhook')}</p>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2.5">
              <code className="min-w-0 flex-1 truncate text-xs">{s.webhookUrl}</code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(s.webhookUrl).then(() => toast.success(t('common.copied')))} aria-label={t('common.copy')} className="rounded p-1 text-ink-3 hover:text-ink">
                <HiOutlineClipboard aria-hidden="true" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              {t('admin.voice.webhookHint')} {s.languages && t('admin.voice.languages', { es: s.languages.es, en: s.languages.en })}
            </p>
          </div>
        )}
        {showPlanNote && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm text-ink">{t('admin.voice.planNote')}</p>}

        <section className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4" aria-labelledby="voice-sim">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="voice-sim" className="text-sm font-semibold">
                {t('admin.voice.simulator')}
              </h3>
              <p className="text-xs text-ink-3">{t('admin.voice.simulatorHint')}</p>
            </div>
            {canSpeak ? (
              <div className="w-40">
                <Switch checked={listen} onChange={setListen} label={t('admin.voice.listen')} />
              </div>
            ) : (
              <p className="text-xs text-ink-3">{t('admin.voice.listenUnsupported')}</p>
            )}
          </div>

          {!active && !lines.length ? (
            <Button icon={<HiOutlinePhone aria-hidden="true" />} onClick={start} loading={turn.isPending}>
              {t('admin.voice.start')}
            </Button>
          ) : (
            <>
              <ol ref={logRef} className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto rounded-xl bg-surface p-3" aria-label={t('admin.voice.transcript')} aria-live="polite">
                {lines.map((l) => (
                  <li key={l.id} className={cn('flex', l.who === 'caller' ? 'justify-end' : 'justify-start')}>
                    <p className={cn('max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm', l.who === 'caller' ? 'rounded-br-sm bg-primary text-primary-fg' : 'rounded-bl-sm bg-surface-3 text-ink')}>
                      <span className="sr-only">{l.who === 'caller' ? t('admin.voice.caller') : t('admin.voice.agent')}: </span>
                      {l.who === 'agent' && (
                        <span className="mb-0.5 flex items-center gap-1 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-3" aria-hidden="true">
                          <HiOutlineSpeakerWave /> {t('admin.voice.agent')}
                        </span>
                      )}
                      {l.text}
                    </p>
                  </li>
                ))}
                {turn.isPending && (
                  <li className="text-xs text-ink-3" role="status">
                    {t('admin.voice.connecting')}
                  </li>
                )}
                {ended && (
                  <li className="text-center text-xs font-medium text-ink-3" role="status">
                    {t('admin.voice.ended')}
                  </li>
                )}
              </ol>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(text);
                  setText('');
                }}
              >
                <Input aria-label={t('admin.voice.speakLabel')} placeholder={t('admin.voice.speakPlaceholder')} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} disabled={!active} />
                <Button type="submit" variant="secondary" disabled={!active || !text.trim()} loading={turn.isPending}>
                  {t('admin.voice.speak')}
                </Button>
              </form>
              <div role="group" aria-label={t('admin.voice.keypad')} className="grid max-w-[240px] grid-cols-3 gap-2">
                {KEYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={!active || turn.isPending}
                    onClick={() => send(d, t('admin.voice.pressed', { d }))}
                    aria-label={t('admin.voice.digit', { d })}
                    className="h-11 rounded-xl border border-border bg-surface font-display text-lg font-semibold text-ink shadow-sm transition hover:bg-surface-3 disabled:opacity-50"
                  >
                    {d}
                  </button>
                ))}
              </div>
              <Button variant="danger" icon={<HiOutlinePhoneXMark aria-hidden="true" />} onClick={hangup}>
                {t('admin.voice.hangup')}
              </Button>
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
