import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { HiMagnifyingGlass, HiOutlineUser } from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/PreferencesContext';
import { NAV } from '@/config/nav';
import { api } from '@/lib/api';
import { cn, fullName } from '@/lib/format';
import type { Patient } from '@/types';

type Item = { id: string; label: string; hint?: string; to: string; icon: typeof HiOutlineUser };

/** ⌘K / Ctrl+K: jump to any section or search patients by name/phone. */
export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const patients = useQuery({
    queryKey: ['patients', 'search', q],
    queryFn: () => api.page<Patient>('/patients', { search: q, pageSize: 5 }),
    enabled: open && q.length >= 2 && can('patients.read'),
  });

  const items = useMemo<Item[]>(() => {
    const pages = NAV.flatMap((g) => g.items)
      .filter((i) => !i.permission || can(i.permission))
      .map((i) => ({ id: i.to, label: t(i.label), to: i.to, icon: i.icon }))
      .filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));
    const people = (patients.data?.items ?? []).map((p) => ({ id: p.id, label: fullName(p), hint: p.phone ?? p.email ?? '', to: `/patients/${p.id}`, icon: HiOutlineUser }));
    return [...pages, ...people];
  }, [q, t, can, patients.data]);

  const close = () => {
    setOpen(false);
    setQ('');
  };

  return (
    <Dialog open={open} onClose={close} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-navy/40 backdrop-blur-sm dark:bg-black/60" />
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-[12vh]">
        <DialogPanel className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-pop">
          <Combobox<Item | null>
            onChange={(item) => {
              if (item) {
                nav(item.to);
                close();
              }
            }}
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <HiMagnifyingGlass className="text-lg text-ink-3" aria-hidden="true" />
              <ComboboxInput autoFocus aria-label={t('common.commandHint')} placeholder={t('common.commandHint')} onChange={(e) => setQ(e.target.value)} className="h-14 w-full bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none" />
            </div>
            <ComboboxOptions static className="scrollbar-thin max-h-80 overflow-y-auto p-2">
              {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-3">{t('common.noResults')}</p>}
              {items.map((i) => (
                <ComboboxOption key={i.id} value={i} className={({ focus }) => cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm', focus && 'bg-primary-soft text-primary')}>
                  <i.icon className="text-lg" aria-hidden="true" />
                  <span className="flex-1 font-medium">{i.label}</span>
                  {i.hint && <span className="text-xs text-ink-3">{i.hint}</span>}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </Combobox>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
