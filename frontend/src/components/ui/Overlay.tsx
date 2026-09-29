import { Dialog as HDialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import type { ReactNode } from 'react';
import { HiXMark } from 'react-icons/hi2';
import { useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import { Button } from './Button';

/** Accessible modal (focus trap, Esc, aria-modal via Headless UI). Becomes a bottom sheet on mobile. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const t = useT();
  const w = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return (
    <HDialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-navy/40 backdrop-blur-[2px] transition-opacity duration-200 data-[closed]:opacity-0 dark:bg-black/60" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4">
        <DialogPanel
          transition
          className={cn(
            'flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-border bg-surface shadow-pop transition duration-200 data-[closed]:translate-y-6 data-[closed]:opacity-0 sm:rounded-2xl',
            w,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
              {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mr-1 rounded-lg p-1.5 text-xl text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={t('common.close')}>
              <HiXMark aria-hidden="true" />
            </button>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
        </DialogPanel>
      </div>
    </HDialog>
  );
}

export function Drawer({ open, onClose, title, children, side = 'right', width = 'max-w-md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: 'left' | 'right'; width?: string }) {
  const t = useT();
  return (
    <HDialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-navy/40 transition-opacity duration-200 data-[closed]:opacity-0 dark:bg-black/60" />
      <div className={cn('fixed inset-y-0 flex w-full', side === 'right' ? 'right-0 justify-end' : 'left-0 justify-start', width)}>
        <DialogPanel
          transition
          className={cn(
            'flex h-full w-full flex-col border-border bg-surface shadow-pop transition duration-200',
            side === 'right' ? 'border-l data-[closed]:translate-x-full' : 'border-r data-[closed]:-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-xl text-ink-3 hover:bg-surface-2" aria-label={t('common.close')}>
              <HiXMark aria-hidden="true" />
            </button>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
        </DialogPanel>
      </div>
    </HDialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger,
  loading,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">{body}</p>
      {children}
    </Modal>
  );
}
