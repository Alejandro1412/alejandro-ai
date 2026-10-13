import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { renderWithPrefs } from '@/test/utils';
import { dpa } from './content/dpa';
import { privacy } from './content/privacy';
import { terms } from './content/terms';
import LegalPage from './LegalPage';

function renderAt(url: string, lang: 'es' | 'en' = 'es') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithPrefs(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/legal/:doc" element={<LegalPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
    { lang },
  );
}

afterEach(() => vi.restoreAllMocks());

describe('legal templates', () => {
  it('keeps Spanish and English in sync (same sections, same ids)', () => {
    for (const doc of [terms, privacy, dpa]) {
      expect(doc.es.sections.length).toBeGreaterThanOrEqual(10);
      expect(doc.en.sections.map((s) => s.id)).toEqual(doc.es.sections.map((s) => s.id));
      expect(new Set(doc.es.sections.map((s) => s.id)).size).toBe(doc.es.sections.length);
    }
  });

  it('renders the disclaimer, table of contents and the clinic as controller', async () => {
    vi.spyOn(api, 'request').mockResolvedValue({
      data: { clinic: { name: 'NovaCare Clínica', slug: 'novacare', phone: '+57 601 555 0100', email: 'hola@novacare.co', website: null, address: 'Calle 100', city: 'Bogotá', country: 'CO', privacyPolicyUrl: 'https://novacare.co/privacidad' } },
    } as never);
    renderAt('/legal/privacy?clinic=novacare');
    expect(screen.getByRole('note')).toHaveTextContent(/revisada y adaptada por un abogado/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(privacy.es.title);
    expect(await screen.findByText('NovaCare Clínica')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver la política de NovaCare Clínica/ })).toHaveAttribute('href', 'https://novacare.co/privacidad');
    expect(screen.getAllByRole('link', { name: /Términos del servicio/ })[0]).toHaveAttribute('href', '/legal/terms?clinic=novacare');
  });

  it('shows a not-found state for unknown documents', () => {
    renderAt('/legal/cookies', 'en');
    expect(screen.getByRole('heading', { name: 'Document not found' })).toBeInTheDocument();
  });
});
