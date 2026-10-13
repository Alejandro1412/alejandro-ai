import { act, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Attachments } from '@/components/chat/Attachments';
import { JourneyBar } from '@/components/chat/ChatThread';
import { RichText } from '@/components/chat/RichText';
import { useChat, type ChatSender } from '@/components/chat/useChat';
import { api } from '@/lib/api';
import { appointmentIcs, googleCalendarUrl } from '@/lib/calendar';
import type { Attachment, CardAppointment, TurnResult } from '@/types';
import { renderWithPrefs } from './utils';

describe('RichText (safe markdown)', () => {
  it('renders bold, bullet lists and https links', () => {
    const { container } = renderWithPrefs(<RichText text={'Puedo ayudarte con:\n• **Agendar** citas\n• Ver [precios](https://example.com/p)'} />);
    expect(container.querySelector('strong')?.textContent).toBe('Agendar');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    const link = screen.getByRole('link', { name: 'precios' });
    expect(link).toHaveAttribute('href', 'https://example.com/p');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('never turns model output into HTML or unsafe links', () => {
    const { container } = renderWithPrefs(<RichText text={'<img src=x onerror=alert(1)> [x](javascript:alert(1)) <script>bad()</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('confirmation card', () => {
  const confirm: Attachment = {
    type: 'confirm',
    title: 'Reservar este horario',
    body: 'viernes 2 oct · 8:00 a. m. — Dra. María García',
    action: { type: 'book_slot', doctorId: 'd1', startTime: '2026-10-02T13:00:00.000Z', serviceId: null },
    confirmLabel: 'Sí, confirmar',
    cancelLabel: 'Elegir otro',
    cancelMessage: 'No, prefiero otro horario',
  };

  it('confirms with the exact action and can only be answered once', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithPrefs(<Attachments items={[confirm]} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /Sí, confirmar/ }));
    expect(onSend).toHaveBeenCalledWith('Sí, confirmar', confirm.action);
    expect(screen.getByRole('button', { name: /Sí, confirmar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir otro' })).toBeDisabled();
  });

  it('declining sends a natural-language answer, not an action', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithPrefs(<Attachments items={[confirm]} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: 'Elegir otro' }));
    expect(onSend).toHaveBeenCalledWith('No, prefiero otro horario');
  });
});

describe('journey bar', () => {
  it('marks the current step for assistive tech', () => {
    renderWithPrefs(<JourneyBar journey={{ flow: 'booking', step: 'time', steps: ['need', 'time', 'details', 'confirm', 'done'] }} />);
    const nav = screen.getByRole('navigation', { name: 'Tu progreso' });
    const current = within(nav).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveTextContent('Horario');
  });
});

describe('add to calendar', () => {
  const appt: CardAppointment = { id: 'a1', doctorId: 'd1', doctorName: 'Dra. María García', specialty: 'Dermatología', serviceName: 'Consulta dermatológica', start: '2026-10-02T13:00:00.000Z', end: '2026-10-02T13:30:00.000Z', when: 'viernes 2 oct, 8:00 a. m.', status: 'CONFIRMED', location: 'Sede Chicó' };
  it('builds a valid iCalendar event with a reminder', () => {
    const ics = appointmentIcs(appt, 'NovaCare');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20261002T130000Z');
    expect(ics).toContain('DTEND:20261002T133000Z');
    expect(ics).toContain('SUMMARY:Consulta dermatológica — Dra. María García');
    expect(ics).toContain('TRIGGER:-PT2H');
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
  });
  it('builds a Google Calendar template link', () => {
    const url = new URL(googleCalendarUrl(appt));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('dates')).toBe('20261002T130000Z/20261002T133000Z');
  });
});

describe('streaming client', () => {
  afterEach(() => vi.restoreAllMocks());

  const sseResponse = (chunks: string[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
          c.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

  it('parses step/delta events split across network chunks and resolves with the done payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(['event: step\ndata: {"type":"tool","name":"getDoctors","phase":"start"}\n\n: ping\n\nevent: del', 'ta\ndata: {"text":"Hola"}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n']),
    );
    const events: [string, unknown][] = [];
    const done = await api.stream<{ conversationId: string }>('/ai/chat/stream', { message: 'x' }, (e, d) => events.push([e, d]));
    expect(done).toEqual({ conversationId: 'c1' });
    expect(events).toEqual([
      ['step', { type: 'tool', name: 'getDoctors', phase: 'start' }],
      ['delta', { text: 'Hola' }],
    ]);
  });

  it('surfaces server errors sent mid-stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse(['event: error\ndata: {"code":"INTERNAL_ERROR","message":"boom"}\n\n']));
    await expect(api.stream('/x', {}, () => undefined)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('useChat live turn', () => {
  it('shows tool progress and streamed text, then the final message and journey', async () => {
    let release!: (r: TurnResult) => void;
    const send: ChatSender = (_t, _a, _c, live) => {
      live.onStep({ type: 'tool', name: 'getAvailableAppointmentSlots', phase: 'start' });
      live.onStep({ type: 'tool', name: 'getAvailableAppointmentSlots', phase: 'end', status: 'SUCCESS' });
      live.onDelta('Claro, ');
      live.onDelta('tengo horarios');
      return new Promise((r) => (release = r));
    };
    const { result } = renderHook(() => useChat(send));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit('cita de dermatología');
    });
    expect(result.current.typing).toBe(true);
    expect(result.current.live?.steps).toEqual([{ key: 'getAvailableAppointmentSlots', label: 'getAvailableAppointmentSlots', done: true, ok: true }]);
    expect(result.current.live?.text).toBe('Claro, tengo horarios');
    await act(async () => {
      release({
        conversationId: 'c1',
        conversationStatus: 'ACTIVE',
        userMessage: { id: 'u1', role: 'USER', content: 'cita de dermatología', attachments: [], createdAt: '' },
        assistantMessage: { id: 'a1', role: 'ASSISTANT', content: 'Claro, tengo horarios', attachments: [], createdAt: '' },
        journey: { flow: 'booking', step: 'time', steps: ['need', 'time', 'details', 'confirm', 'done'] },
      });
      await pending;
    });
    expect(result.current.live).toBeNull();
    expect(result.current.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(result.current.journey?.step).toBe('time');
  });
});
