import { useState } from 'react';
import type { RestaurantTable } from '@feedbook/types';
import { supabase } from '../lib/supabase';
import { CheckIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

type TableStatus = 'available' | 'occupied' | 'awaiting_cleaning';

const STATUS_LABEL_KEYS: Record<TableStatus, TranslationKey> = {
  available: 'tableStatusAvailable',
  occupied: 'tableStatusOccupied',
  awaiting_cleaning: 'tableStatusAwaitingCleaning',
};

const STATUS_PILL_CLASSES: Record<TableStatus, string> = {
  available: 'bg-success-soft text-success',
  occupied: 'bg-danger-soft text-danger',
  awaiting_cleaning: 'bg-warning-soft text-warning',
};

const STATUS_DOT_CLASSES: Record<TableStatus, string> = {
  available: 'bg-success',
  occupied: 'bg-danger',
  awaiting_cleaning: 'bg-warning',
};

interface Props {
  tables: RestaurantTable[];
  onRefresh: () => void;
}

// PRD §5.1.3 "ניהול סטטוס שולחן" (2026-10-15) — never surfaced anywhere
// before; TableManagerContent below this card is a configuration view
// (tables grouped by type/capacity, meant for setup), not a live per-table
// status view, so this is a separate component rather than squeezed into
// that one. Individual tables only (no grouping) since status is inherently
// per-table. scan-qr sets 'occupied' when a diner joins; close-session sets
// 'awaiting_cleaning' once every share is paid — staff clear it back to
// 'available' here once the table is physically ready again.
export function TableStatusBoard({ tables, onRefresh }: Props) {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleMarkAvailable(tableId: string) {
    setError(null);
    setBusyId(tableId);
    const { error: updateError } = await supabase.from('tables').update({ status: 'available' }).eq('id', tableId);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onRefresh();
  }

  const sorted = [...tables].sort((a, b) => a.table_number.localeCompare(b.table_number, undefined, { numeric: true }));

  return (
    <div className="card p-6">
      <h2 className="mb-1 text-lg font-bold text-ink">{t('tableStatusBoardTitle')}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t('tableStatusBoardSubtitle')}</p>

      {error && <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tableQuickAddHint')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((table) => {
            const status = (table.status as TableStatus | null) ?? 'available';
            return (
              <div key={table.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink">
                    {t('tableNumberLabel')} {table.table_number}
                  </span>
                  <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL_CLASSES[status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`} />
                    {t(STATUS_LABEL_KEYS[status])}
                  </span>
                </div>
                {status === 'awaiting_cleaning' && (
                  <button
                    type="button"
                    disabled={busyId === table.id}
                    onClick={() => void handleMarkAvailable(table.id)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded bg-accent px-2 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    {t('tableMarkCleanAction')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
