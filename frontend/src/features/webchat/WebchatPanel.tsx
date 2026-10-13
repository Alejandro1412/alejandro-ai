import { Isotype } from '@/components/brand/Logo';
import { ChatThread } from '@/components/chat/ChatThread';
import { Skeleton } from '@/components/ui/Feedback';
import { useT } from '@/contexts/PreferencesContext';
import type { useWebchat } from './useWebchat';

/** Chat body shared by the full-page webchat, the embeddable widget and the landing demo. */
export function WebchatPanel({ w, poweredBy = true }: { w: ReturnType<typeof useWebchat>; poweredBy?: boolean }) {
  const t = useT();
  const { chat, ready, failed, onFeedback } = w;
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        {!ready ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-16 w-3/4 rounded-2xl" />
            <Skeleton className="h-10 w-1/2 rounded-2xl" />
          </div>
        ) : failed ? (
          <p className="p-6 text-center text-sm text-ink-2">{t('chat.errorSend')}</p>
        ) : (
          <ChatThread
            messages={chat.messages}
            typing={chat.typing}
            live={chat.live}
            journey={chat.journey}
            onFeedback={onFeedback}
            onSend={(text, action) => void chat.submit(text, action)}
            composerDisabledReason={chat.status === 'HANDOFF' ? t('chat.humanActive') : undefined}
          />
        )}
      </div>
      {poweredBy && (
        <footer className="flex items-center justify-center gap-1.5 border-t border-border bg-surface py-1.5 text-[0.65rem] text-ink-3">
          <Isotype size={12} /> Powered by Alejandro AI
        </footer>
      )}
    </>
  );
}
