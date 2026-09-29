import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { HiCheckCircle, HiExclamationCircle, HiInformationCircle, HiXMark } from 'react-icons/hi2';
import { cn } from '@/lib/format';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

const Ctx = createContext<((t: Omit<ToastItem, 'id'>) => void) | null>(null);
let seq = 0;

/** Toasts are announced to screen readers through aria-live regions (polite / assertive for errors). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++seq;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4200);
  }, []);
  const icon = { success: HiCheckCircle, error: HiExclamationCircle, info: HiInformationCircle };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
        <div aria-live="polite" className="contents">
          {items
            .filter((i) => i.tone !== 'error')
            .map((i) => (
              <ToastView key={i.id} item={i} Icon={icon[i.tone]} onClose={() => setItems((xs) => xs.filter((x) => x.id !== i.id))} />
            ))}
        </div>
        <div aria-live="assertive" className="contents">
          {items
            .filter((i) => i.tone === 'error')
            .map((i) => (
              <ToastView key={i.id} item={i} Icon={icon.error} onClose={() => setItems((xs) => xs.filter((x) => x.id !== i.id))} />
            ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ item, Icon, onClose }: { item: ToastItem; Icon: typeof HiCheckCircle; onClose: () => void }) {
  return (
    <div role="status" className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-2xl border border-border bg-surface p-3.5 shadow-pop">
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', item.tone === 'success' ? 'text-success' : item.tone === 'error' ? 'text-danger' : 'text-info')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{item.title}</p>
        {item.body && <p className="mt-0.5 text-sm text-ink-2">{item.body}</p>}
      </div>
      <button type="button" onClick={onClose} className="rounded-md p-0.5 text-ink-3 hover:text-ink" aria-label="Dismiss">
        <HiXMark aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  if (!push) throw new Error('useToast must be used within ToastProvider');
  return useMemo(
    () => ({
      success: (title: string, body?: string) => push({ tone: 'success', title, body }),
      error: (title: string, body?: string) => push({ tone: 'error', title, body }),
      info: (title: string, body?: string) => push({ tone: 'info', title, body }),
    }),
    [push],
  );
}
