import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Attachments } from '@/components/chat/Attachments';
import { Composer } from '@/components/chat/ChatThread';
import type { Attachment } from '@/types';
import { renderWithPrefs } from './utils';

const slots: Attachment = {
  type: 'slots',
  mode: 'book',
  serviceId: 'svc-1',
  timezone: 'America/Bogota',
  groups: [
    {
      doctorId: 'doc-1',
      doctorName: 'Dra. María García',
      specialty: 'Dermatología',
      slots: [
        { start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T15:30:00.000Z', day: 'jueves 1 oct', time: '10:00 a. m.' },
        { start: '2026-10-02T20:00:00.000Z', end: '2026-10-02T20:30:00.000Z', day: 'viernes 2 oct', time: '3:00 p. m.' },
      ],
    },
  ],
};

describe('chat slot cards', () => {
  it('asks for confirmation before booking and sends a book_slot action with the exact ids', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithPrefs(<Attachments items={[slots]} onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /viernes 2 oct 3:00 p\. m\./i }));
    expect(onSend).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Dra\. María García/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('3:00 p. m.'), {
      type: 'book_slot',
      doctorId: 'doc-1',
      startTime: '2026-10-02T20:00:00.000Z',
      serviceId: 'svc-1',
    });
  });

  it('cancelling the dialog does not book', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithPrefs(<Attachments items={[slots]} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /jueves 1 oct/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('slot buttons are disabled when the chat is read-only', () => {
    renderWithPrefs(<Attachments items={[slots]} />);
    for (const b of screen.getAllByRole('button', { name: /oct/i })) expect(b).toBeDisabled();
  });

  it('renders the emergency notice and appointment cards from tool data', () => {
    renderWithPrefs(
      <Attachments
        items={[
          { type: 'emergency' },
          {
            type: 'appointment',
            state: 'created',
            appointment: { id: 'a1', doctorId: 'doc-1', doctorName: 'Dra. María García', specialty: 'Dermatología', serviceName: 'Consulta', start: '', end: '', when: 'viernes 2 oct, 3:00 p. m.', status: 'CONFIRMED', location: 'Sede Chicó' },
          },
        ]}
      />,
    );
    expect(screen.getByText(/123/)).toBeInTheDocument();
    expect(screen.getByText('viernes 2 oct, 3:00 p. m.', { exact: false })).toBeInTheDocument();
  });
});

describe('chat composer', () => {
  it('sends on Enter, keeps multi-line with Shift+Enter and clears after sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithPrefs(<Composer onSend={onSend} />, { lang: 'en' });
    const box = screen.getByRole('textbox');
    await user.type(box, 'Hello{Shift>}{Enter}{/Shift}there');
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('Hello\nthere');
    expect(box).toHaveValue('');
  });

  it('does not send blank messages', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithPrefs(<Composer onSend={onSend} />, { lang: 'en' });
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('shows the reason instead of an input when the conversation is with a human', () => {
    renderWithPrefs(<Composer onSend={vi.fn()} disabledReason="A team member is handling this conversation" />, { lang: 'en' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText(/team member/)).toBeInTheDocument();
  });
});
