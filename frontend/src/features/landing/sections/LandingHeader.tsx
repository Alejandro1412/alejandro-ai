import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { useT } from '@/contexts/PreferencesContext';
import { A11yButton, LangSwitch, ThemeMenu } from '@/layouts/Controls';
import { cn } from '@/lib/format';

/**
 * Floating header: transparent and dark-scoped over the cinematic hero, then a blurred bar in the
 * current theme once the page scrolls. Hides while scrolling down and returns on scroll up.
 */
export function LandingHeader() {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      setHidden(y > 480 && y > last + 4);
      if (y < last - 4) setHidden(false);
      last = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[transform,background-color,border-color] duration-500',
        scrolled ? 'border-b border-border/70 bg-bg/80 backdrop-blur-xl' : 'dark border-b border-transparent bg-transparent',
        hidden && '-translate-y-full',
      )}
      onFocusCapture={() => setHidden(false)}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="Alejandro AI" data-no-underline>
          <Logo />
        </Link>
        <nav aria-label="Landing" className="ml-6 hidden items-center gap-1 text-sm font-medium text-ink-2 md:flex">
          {[
            ['#product', t('landing.navFeatures')],
            ['#pricing', t('landing.navPricing')],
            ['#faq', t('landing.navFaq')],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-lg px-3 py-2 transition hover:bg-surface-2/60 hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-0.5">
          <LangSwitch compact />
          <span className="hidden sm:flex">
            <ThemeMenu />
          </span>
          <A11yButton />
          <Link to="/login" className="hidden rounded-xl px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink sm:inline-flex">
            {t('landing.signIn')}
          </Link>
          <ButtonLink to="/register" size="sm" className="ml-1 hidden sm:inline-flex">
            {t('landing.getStarted')}
          </ButtonLink>
          <Link to="/login" className="rounded-xl px-2.5 py-2 text-sm font-semibold text-primary sm:hidden">
            {t('landing.signIn')}
          </Link>
        </div>
      </div>
    </header>
  );
}
