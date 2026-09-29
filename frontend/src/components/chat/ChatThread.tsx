import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { HiMicrophone, HiOutlineSpeakerWave, HiOutlineStopCircle, HiPaperAirplane } from 'react-icons/hi2';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { cn, fmtTime } from '@/lib/format';
import type { Attachment, ChatAction, Message } from '@/types';
import { AgentAvatar } from '../brand/Logo';
import { Attachments } from './Attachments';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SRConstructor = new () => SpeechRecognitionLike;

function speak(text: string, lang: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#•]/g, ''));
  u.lang = lang === 'en' ? 'en-US' : 'es-CO';
  window.speechSynthesis.speak(u);
}

export function TypingIndicator() {
  const t = useT();
  return (
    <div className="flex items-end gap-2.5" role="status" aria-label={t('chat.typing')}>
      <AgentAvatar size={30} />
      <div className="flex gap-1 rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3 shadow-card">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 animate-pulse3 rounded-full bg-ink-3" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Messaging-app style chat used by the playground, patient portal and public webchat.
 * Accessible: role="log" + aria-live for replies, keyboard-first composer, optional voice input and read-aloud.
 */
export function ChatThread({
  messages,
  typing,
  onSend,
  readOnly,
  className,
  emptyHint,
  showDisclaimer = true,
  composerDisabledReason,
}: {
  messages: Message[];
  typing?: boolean;
  onSend?: (text: string, action?: ChatAction) => void;
  readOnly?: boolean;
  className?: string;
  emptyHint?: string;
  showDisclaimer?: boolean;
  composerDisabledReason?: string;
}) {
  const t = useT();
  const { prefs } = usePreferences();
  const endRef = useRef<HTMLDivElement>(null);
  const lastSpoken = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: prefs.reduceMotion ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, typing, prefs.reduceMotion]);

  // Auto read-aloud for users who enabled it (screen-reader-free voice experience).
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === 'ASSISTANT');
    if (prefs.readAloud && last && last.id !== lastSpoken.current && messages.length > 1) {
      lastSpoken.current = last.id;
      speak(last.content, prefs.lang);
    }
  }, [messages, prefs.readAloud, prefs.lang]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'ASSISTANT');
  const suggestions = !readOnly && !typing && lastAssistant === messages[messages.length - 1] ? (lastAssistant?.attachments.find((a) => a.type === 'suggestions') as Extract<Attachment, { type: 'suggestions' }> | undefined) : undefined;

  const toggleSpeak = (m: Message) => {
    if (speaking === m.id) {
      window.speechSynthesis?.cancel();
      setSpeaking(null);
    } else {
      speak(m.content, prefs.lang);
      setSpeaking(m.id);
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat" className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5">
        {!messages.length && emptyHint && <p className="px-6 py-10 text-center text-sm text-ink-3">{emptyHint}</p>}
        {messages.map((m) => {
          const mine = m.role === 'USER';
          const staff = m.role === 'STAFF';
          return (
            <div key={m.id} className={cn('flex animate-slide-up items-end gap-2.5', mine && 'flex-row-reverse')}>
              {!mine && (staff ? <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-white">EQ</span> : <AgentAvatar size={30} />)}
              <div className={cn('flex min-w-0 max-w-[88%] flex-col sm:max-w-[80%]', mine && 'items-end')}>
                {staff && <span className="mb-1 text-xs font-medium text-accent-strong dark:text-accent">{t('chat.staff')}</span>}
                <div
                  className={cn(
                    'whitespace-pre-line break-words rounded-2xl px-4 py-2.5 text-[0.95rem] leading-relaxed',
                    mine ? 'rounded-br-md bg-primary text-primary-fg' : staff ? 'rounded-bl-md border border-accent/30 bg-accent-soft text-ink' : 'rounded-bl-md border border-border bg-surface text-ink shadow-card',
                  )}
                >
                  <span className="sr-only">{mine ? `${t('chat.you')}: ` : staff ? `${t('chat.staff')}: ` : 'Alejandro AI: '}</span>
                  {m.content}
                </div>
                {!mine && m.attachments?.length > 0 && <Attachments items={m.attachments} onSend={readOnly ? undefined : onSend} disabled={typing} />}
                <div className={cn('mt-1 flex items-center gap-2 px-1 text-[0.7rem] text-ink-3', mine && 'flex-row-reverse')}>
                  <time dateTime={m.createdAt}>{fmtTime(m.createdAt, prefs.lang)}</time>
                  {m.role === 'ASSISTANT' && 'speechSynthesis' in window && (
                    <button type="button" onClick={() => toggleSpeak(m)} className="inline-flex items-center gap-1 rounded px-1 hover:text-ink" aria-label={speaking === m.id ? t('common.stopReading') : t('common.readAloud')}>
                      {speaking === m.id ? <HiOutlineStopCircle aria-hidden="true" /> : <HiOutlineSpeakerWave aria-hidden="true" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {typing && <TypingIndicator />}
        {suggestions && onSend && (
          <div className="flex flex-wrap gap-2 pl-10" role="group" aria-label="Suggestions">
            {suggestions.items.map((s) => (
              <button key={s.label} type="button" onClick={() => onSend(s.message)} className="rounded-full border border-primary/30 bg-primary-soft px-3.5 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/15">
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
      {!readOnly && onSend && <Composer onSend={onSend} disabled={typing} disabledReason={composerDisabledReason} />}
      {showDisclaimer && !readOnly && <p className="safe-bottom px-4 pb-2 text-center text-[0.7rem] text-ink-3">{t('chat.aiDisclaimer')}</p>}
    </div>
  );
}

export function Composer({ onSend, disabled, disabledReason }: { onSend: (text: string) => void; disabled?: boolean; disabledReason?: string }) {
  const t = useT();
  const { prefs } = usePreferences();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const SR = (window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: SRConstructor }).webkitSpeechRecognition;

  const submit = useCallback(() => {
    const v = text.trim();
    if (!v || disabled) return;
    onSend(v);
    setText('');
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto';
    });
  }, [text, disabled, onSend]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const toggleVoice = () => {
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = prefs.lang === 'en' ? 'en-US' : 'es-CO';
    rec.interimResults = true;
    rec.onresult = (e) => setText(Array.from(e.results).map((r) => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  if (disabledReason)
    return <div className="border-t border-border bg-surface-2 px-4 py-3 text-center text-sm text-ink-2">{disabledReason}</div>;

  return (
    <form
      className="border-t border-border bg-surface px-3 py-3 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-2 p-1.5 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
        <label htmlFor="chat-input" className="sr-only">
          {t('chat.placeholder')}
        </label>
        <textarea
          id="chat-input"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={onKey}
          placeholder={listening ? t('chat.listening') : t('chat.placeholder')}
          maxLength={2000}
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[0.95rem] text-ink placeholder:text-ink-3 focus:outline-none"
        />
        {SR && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={listening}
            aria-label={t('chat.voiceInput')}
            className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg transition', listening ? 'animate-pulse bg-danger text-white' : 'text-ink-3 hover:bg-surface-3 hover:text-ink')}
          >
            <HiMicrophone aria-hidden="true" />
          </button>
        )}
        <button type="submit" disabled={disabled || !text.trim()} aria-label={t('chat.send')} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-lg text-primary-fg transition hover:bg-primary-strong disabled:opacity-40">
          <HiPaperAirplane aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
