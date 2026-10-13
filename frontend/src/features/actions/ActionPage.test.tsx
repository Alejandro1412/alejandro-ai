import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { renderWithPrefs } from '@/test/utils';
import ActionPage from './ActionPage';
import type { ActionInfo } from './types';

const TOKEN = 'a'.repeat(43);
const clinic = { name: 'NovaCare Clínica', slug: 'novacare', phone: '+57 601 555 0100', timezone: 'America/Bogota', privacyPolicyUrl: null };
const appointment = {
  doctor: 'Dra. María García',
  specialty: 'Medicina general',
  service: 'Consulta general',
  when: 'viernes 2 oct · 8:00 a. m.',
  start: '2026-10-02T13:00:00.000Z',
  status: 'CONFIRMED',
  location: 'Sede Norte — Calle 100',
  videoUrl: null,
  patientFirstName: 'Laura',
  patientConfirmed: false,
  depositStatus: 'NONE' as const,
  depositCents: null,
  currency: 'COP',
  language: 'es',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithPrefs(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/a/${TOKEN}`]}>
        <Routes>
          <Route path="/a/:token" element={<ActionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const describeAs = (info: Partial<ActionInfo>) =>
  vi.spyOn(api, 'request').mockResolvedValue({ data: { expiresAt: '2026-10-05T00:00:00.000Z', clinic, ...info } } as never);

afterEach(() => vi.restoreAllMocks());

describe('ActionPage (/a/:token)', () => {
  it('confirms attendance anonymously and shows the success state', async () => {
    describeAs({ purpose: 'confirm', appointment });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ done: true, status: 'CONFIRMED' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmo mi asistencia/ }));
    expect(post).toHaveBeenCalledWith(`/public/actions/${TOKEN}`, {}, { anonymous: true });
    expect(await screen.findByRole('heading', { name: '¡Asistencia confirmada!' })).toBeInTheDocument();
  });

  it('asks for a second confirmation before cancelling and links to book again', async () => {
    describeAs({ purpose: 'cancel', appointment });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ done: true, status: 'CANCELLED' });
    renderPage();
    await userEvent.type(await screen.findByLabelText(/Motivo/), 'Viaje');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar mi cita' }));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, cancelar la cita' }));
    expect(post).toHaveBeenCalledWith(`/public/actions/${TOKEN}`, { reason: 'Viaje' }, { anonymous: true });
    expect(await screen.findByRole('link', { name: /Agendar una nueva cita/ })).toHaveAttribute('href', '/c/novacare');
  });

  it('explains a used link', async () => {
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError(410, 'ACTION_LINK_USED', 'used'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Este enlace ya se usó' })).toBeInTheDocument();
  });

  it('handles a waitlist slot taken by someone else', async () => {
    describeAs({ purpose: 'waitlist', offer: { doctor: 'Dr. Juan Pérez', when: 'lunes', start: '2026-10-05T14:00:00.000Z', available: true } });
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, 'OFFER_TAKEN', 'taken'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Tomar este horario' }));
    expect(await screen.findByRole('heading', { name: 'Alguien lo tomó primero' })).toBeInTheDocument();
  });

  it('rates with an accessible radio group and offers sharing on Google', async () => {
    describeAs({ purpose: 'review', review: { doctor: 'Dra. María García', answered: false } });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ done: true, redirectUrl: 'https://g.page/r/novacare/review' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar mi opinión' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una calificación');
    await userEvent.click(screen.getByRole('radio', { name: /5 de 5 estrellas/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mi opinión' }));
    expect(post).toHaveBeenCalledWith(`/public/actions/${TOKEN}`, { rating: 5 }, { anonymous: true });
    const share = await screen.findByRole('link', { name: /Compartir en Google/ });
    expect(share).toHaveAttribute('target', '_blank');
  });

  it('validates the intake form on the client before sending', async () => {
    describeAs({ purpose: 'intake', appointment, fields: [{ key: 'reason', label: 'Motivo de consulta', type: 'text', required: true }], answers: null });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ saved: true });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar respuestas' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Motivo de consulta/)).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(screen.getByLabelText(/Motivo de consulta/), 'Control');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
    expect(post).toHaveBeenCalledWith(`/public/actions/${TOKEN}`, { answers: { reason: 'Control' } }, { anonymous: true });
    expect(await screen.findByRole('button', { name: /Editar mis respuestas/ })).toBeInTheDocument();
  });
});
