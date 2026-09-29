import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/ui/DataTable';

interface Row {
  id: string;
  name: string;
  status: string;
}
const rows: Row[] = [
  { id: '1', name: 'María Rodríguez', status: 'CONFIRMED' },
  { id: '2', name: 'John Miller', status: 'PENDING' },
];

describe('DataTable', () => {
  it('renders an accessible table with caption and headers plus a mobile card list', () => {
    render(
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        caption="Patients"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => r.name },
          { key: 'status', header: 'Status', cell: (r) => r.status },
        ]}
        mobileCard={(r) => <span>card {r.name}</span>}
      />,
    );
    const table = screen.getByRole('table', { name: 'Patients' });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Status']);
    expect(screen.getByText('card John Miller')).toBeInTheDocument();
  });

  it('rows are keyboard-activatable when clickable', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable rows={rows} rowKey={(r) => r.id} caption="Patients" columns={[{ key: 'name', header: 'Name', cell: (r) => r.name }]} mobileCard={(r) => r.name} onRowClick={onRowClick} />,
    );
    const row = screen.getAllByRole('row')[1];
    row.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
