import type { IconType } from 'react-icons';
import { HiCheck } from 'react-icons/hi2';
import { useT } from '@/contexts/PreferencesContext';
import { gsap } from '@/lib/motion/gsap';
import { SplitHeading } from '@/lib/motion/primitives';
import { useGsap } from '@/lib/motion/useMotion';

export interface StackItem {
  icon: IconType;
  title: string;
  body: string;
  points: string[];
  tint: string;
}

/**
 * Sticky stacking cards: each card sticks under the header and, as the next one slides over it,
 * recedes (scale + dim) so the pile reads like a deck being dealt.
 */
export function StackCards({ items }: { items: StackItem[] }) {
  const t = useT();
  const ref = useGsap<HTMLElement>(
    ({ root, motion }) => {
      if (!motion) return;
      const cards = gsap.utils.toArray<HTMLElement>('[data-stack-card]', root);
      cards.forEach((card, i) => {
        const next = cards[i + 1];
        if (!next) return;
        const st = { trigger: next, start: 'top bottom', end: 'top 20%', scrub: true };
        gsap.to(card.querySelector('[data-stack-inner]'), { scale: 0.9 + i * 0.02, ease: 'none', scrollTrigger: st });
        gsap.to(card.querySelector('[data-stack-shade]'), { opacity: 1, ease: 'none', scrollTrigger: st });
      });
    },
    [items.length],
  );

  return (
    <section ref={ref} className="relative bg-bg py-24 sm:py-32" aria-labelledby="stack-h">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-14 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{t('landing.stackEyebrow')}</p>
          <SplitHeading id="stack-h" className="mx-auto mt-3 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            {t('landing.stackTitle')}
          </SplitHeading>
        </div>
        <ul className="space-y-8">
          {items.map((it, i) => (
            <li key={it.title} data-stack-card className="sticky" style={{ top: `${88 + i * 18}px` }}>
              <article data-stack-inner className="spotlight grid origin-top gap-8 overflow-hidden rounded-[2rem] border border-border bg-surface p-7 shadow-pop sm:p-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <span data-stack-shade className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-ink/[0.06] opacity-0 dark:bg-black/45" aria-hidden="true" />
                <div>
                  <span className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${it.tint}`}>
                    <it.icon aria-hidden="true" />
                  </span>
                  <h3 className="mt-6 font-display text-3xl font-bold tracking-tight">{it.title}</h3>
                  <p className="mt-3 text-ink-2">{it.body}</p>
                </div>
                <ul className="space-y-3 self-center">
                  {it.points.map((p) => (
                    <li key={p} className="flex items-start gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium">
                      <HiCheck className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
