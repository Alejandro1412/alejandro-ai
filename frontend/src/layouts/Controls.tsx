import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { HiOutlineComputerDesktop, HiOutlineLanguage, HiOutlineMoon, HiOutlineSun } from 'react-icons/hi2';
import { MdOutlineAccessibilityNew } from 'react-icons/md';
import { useState } from 'react';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import { Drawer } from '@/components/ui/Overlay';
import { Switch } from '@/components/ui/Field';
import { Kbd, Segmented } from '@/components/ui/Display';

export function ThemeMenu() {
  const t = useT();
  const { prefs, setPrefs, resolvedTheme } = usePreferences();
  const opts = [
    { v: 'light' as const, label: t('common.light'), icon: HiOutlineSun },
    { v: 'dark' as const, label: t('common.dark'), icon: HiOutlineMoon },
    { v: 'system' as const, label: t('common.system'), icon: HiOutlineComputerDesktop },
  ];
  const Current = resolvedTheme === 'dark' ? HiOutlineMoon : HiOutlineSun;
  return (
    <Menu as="div" className="relative">
      <MenuButton className="grid h-10 w-10 place-items-center rounded-xl text-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={t('common.theme')} title={t('common.theme')}>
        <Current aria-hidden="true" />
      </MenuButton>
      <MenuItems anchor="bottom end" className="z-50 mt-2 w-44 rounded-xl border border-border bg-surface p-1 shadow-pop focus:outline-none">
        {opts.map((o) => (
          <MenuItem key={o.v}>
            <button
              type="button"
              onClick={() => setPrefs({ theme: o.v })}
              className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm data-[focus]:bg-surface-2', prefs.theme === o.v ? 'font-semibold text-primary' : 'text-ink')}
            >
              <o.icon aria-hidden="true" />
              {o.label}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

export function LangSwitch({ compact }: { compact?: boolean }) {
  const t = useT();
  const { prefs, setPrefs } = usePreferences();
  const next = prefs.lang === 'es' ? 'en' : 'es';
  return (
    <button
      type="button"
      onClick={() => setPrefs({ lang: next })}
      className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={`${t('common.language')}: ${prefs.lang === 'es' ? t('common.spanish') : t('common.english')}. ${next === 'en' ? 'Switch to English' : 'Cambiar a español'}`}
    >
      <HiOutlineLanguage className="text-lg" aria-hidden="true" />
      {!compact && <span className="uppercase">{prefs.lang}</span>}
    </button>
  );
}

export function A11yButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl text-xl text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={t('a11y.open')} title={t('a11y.open')}>
        <MdOutlineAccessibilityNew aria-hidden="true" />
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t('a11y.title')}>
        <A11yPanel />
      </Drawer>
    </>
  );
}

/** Accessibility preferences for low-vision and motion-sensitive users. */
export function A11yPanel() {
  const t = useT();
  const { prefs, setPrefs, reset } = usePreferences();
  const scales = [
    { value: '1', label: 'A' },
    { value: '1.125', label: 'A+' },
    { value: '1.25', label: 'A++' },
    { value: '1.5', label: 'A+++' },
  ];
  return (
    <div className="space-y-6 p-5">
      <p className="text-sm text-ink-2">{t('a11y.subtitle')}</p>
      <div>
        <p className="label">{t('a11y.textSize')}</p>
        <Segmented label={t('a11y.textSize')} value={String(prefs.fontScale)} onChange={(v) => setPrefs({ fontScale: Number(v) })} options={scales} />
      </div>
      <div>
        <p className="label">{t('common.theme')}</p>
        <Segmented
          label={t('common.theme')}
          value={prefs.theme}
          onChange={(v) => setPrefs({ theme: v })}
          options={[
            { value: 'light', label: t('common.light') },
            { value: 'dark', label: t('common.dark') },
            { value: 'system', label: t('common.system') },
          ]}
        />
      </div>
      <div>
        <p className="label">{t('common.language')}</p>
        <Segmented
          label={t('common.language')}
          value={prefs.lang}
          onChange={(v) => setPrefs({ lang: v })}
          options={[
            { value: 'es', label: 'Español' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <div className="divide-y divide-border rounded-2xl border border-border px-4">
        <Switch label={t('a11y.highContrast')} description={t('a11y.highContrastHint')} checked={prefs.highContrast} onChange={(v) => setPrefs({ highContrast: v })} />
        <Switch label={t('a11y.readableFont')} description={t('a11y.readableFontHint')} checked={prefs.readableFont} onChange={(v) => setPrefs({ readableFont: v })} />
        <Switch label={t('a11y.reduceMotion')} description={t('a11y.reduceMotionHint')} checked={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} />
        <Switch label={t('a11y.underlineLinks')} checked={prefs.underlineLinks} onChange={(v) => setPrefs({ underlineLinks: v })} />
        <Switch label={t('a11y.readAloud')} description={t('a11y.readAloudHint')} checked={prefs.readAloud} onChange={(v) => setPrefs({ readAloud: v })} />
      </div>
      <div>
        <p className="label">{t('a11y.keyboard')}</p>
        <ul className="space-y-2 text-sm text-ink-2">
          <li className="flex items-center justify-between">
            {t('a11y.shortcutSearch')}
            <span className="flex gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </li>
          <li className="flex items-center justify-between">
            {t('common.skipToContent')}
            <Kbd>Tab</Kbd>
          </li>
        </ul>
      </div>
      <button type="button" onClick={reset} className="text-sm font-medium text-primary hover:underline">
        {t('a11y.reset')}
      </button>
    </div>
  );
}
