import { useState } from 'react';
import type { RestaurantTable } from '@feedbook/types';
import { supabase } from '../lib/supabase';
import { CheckIcon, AlertIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { useBarStatus } from '../lib/useBarStatus';
import { useRestaurantStatus } from '../lib/useRestaurantStatus';

type TableStatus = 'available' | 'occupied' | 'awaiting_cleaning';
// 'closed' (2026-11-02) is a display-only state, never stored on
// tables.status — it's what an 'available' table shows once the
// restaurant's own hours say it's closed (see restaurant_is_active), so a
// real "come sit here" availability is never implied while the restaurant
// isn't actually taking new arrivals. An occupied/awaiting_cleaning table
// keeps showing its real physical state regardless — someone may still be
// there, or it may still need clearing, whether or not the restaurant is
// "open" right now.
type DisplayStatus = TableStatus | 'closed';

const STATUS_LABEL_KEYS: Record<DisplayStatus, TranslationKey> = {
  available: 'tableStatusAvailable',
  occupied: 'tableStatusOccupied',
  awaiting_cleaning: 'tableStatusAwaitingCleaning',
  closed: 'tableStatusClosed',
};

const STATUS_PILL_CLASSES: Record<DisplayStatus, string> = {
  available: 'bg-success-soft text-success',
  occupied: 'bg-danger-soft text-danger',
  awaiting_cleaning: 'bg-warning-soft text-warning',
  closed: 'bg-danger-soft text-danger',
};

const STATUS_DOT_CLASSES: Record<DisplayStatus, string> = {
  available: 'bg-success',
  occupied: 'bg-danger',
  awaiting_cleaning: 'bg-warning',
  closed: 'bg-danger',
};

interface Props {
  restaurantId: string;
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
export function TableStatusBoard({ restaurantId, tables, onRefresh }: Props) {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Not every restaurant has a bar — the hook still runs (rules of hooks),
  // but its queries are harmless no-ops when there's no table_type='bar'
  // row for it to find. The card itself is only rendered when barTable
  // exists, right below.
  const { active: barActive } = useBarStatus(restaurantId);
  const barTable = tables.find((table) => table.table_type === 'bar' && !table.archived_at);
  const { active: restaurantActive } = useRestaurantStatus(restaurantId);

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

  // The bar is a shared singleton row (any number of diners join/leave
  // independently all day, no capacity cap — see TableManagerForm.tsx) —
  // occupied/available/awaiting_cleaning doesn't map cleanly onto it the way
  // it does a regular table, so it's excluded here (2026-10-15, user
  // decision) and stays visible only in the configuration list below.
  const sorted = tables
    .filter((table) => table.table_type !== 'bar')
    .sort((a, b) => a.table_number.localeCompare(b.table_number, undefined, { numeric: true }));

  return (
    <div className="card p-6">
      <h2 className="mb-1 text-lg font-bold text-ink">{t('tableStatusBoardTitle')}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t('tableStatusBoardSubtitle')}</p>

      {error && <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {restaurantActive === false && (
        <div className="mb-4 flex items-start gap-2 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('tableStatusBoardClosedBanner')}</span>
        </div>
      )}

      {sorted.length === 0 && !barTable ? (
        <p className="text-sm text-muted-foreground">{t('tableQuickAddHint')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {barTable && (
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-ink">{t('tableTypeBar')}</span>
                <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${barActive ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${barActive ? 'bg-success' : 'bg-danger'}`} />
                  {barActive ? t('tableStatusBarActive') : t('tableStatusClosed')}
                </span>
              </div>
            </div>
          )}
          {sorted.map((table) => {
            const status = (table.status as TableStatus | null) ?? 'available';
            // Real occupancy state is untouched — only how an 'available'
            // table is LABELED changes once the restaurant is closed (see
            // the DisplayStatus type's own comment above).
            const displayStatus: DisplayStatus = status === 'available' && restaurantActive === false ? 'closed' : status;
            return (
              <div key={table.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink">
                    {t('tableNumberLabel')} {table.table_number}
                  </span>
                  <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL_CLASSES[displayStatus]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[displayStatus]}`} />
                    {t(STATUS_LABEL_KEYS[displayStatus])}
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
