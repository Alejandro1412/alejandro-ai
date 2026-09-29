import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { renderWithPrefs } from './utils';

describe('motion respects accessibility preferences', () => {
  it('screen readers always get the final value while the number animates', () => {
    renderWithPrefs(<AnimatedNumber to={237} format={(n) => `${n} convs`} />);
    expect(screen.getByText('237 convs')).toHaveClass('sr-only');
  });

  it('with "reduce motion" on, the visible number is final immediately', () => {
    renderWithPrefs(<AnimatedNumber to={91} format={(n) => `${n}%`} />, { prefs: { reduceMotion: true } });
    expect(screen.getAllByText('91%')).toHaveLength(2);
  });
});
