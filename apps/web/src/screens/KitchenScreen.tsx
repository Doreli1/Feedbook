import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { KitchenItemStatus, KitchenOrderItem } from '../lib/useOrders';
import type { KitchenWaiterCall } from '../lib/useWaiterCalls';
import { useOrderHistory } from '../lib/useOrderHistory';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { BarTicketLabelModal } from '../components/BarTicketLabelModal';

interface KitchenFocusRequest {
  orderId: string | null;
  orderItemId: string | null;
}

interface Props {
  restaurantId: string;
  items: KitchenOrderItem[];
  waiterCalls: KitchenWaiterCall[];
  onRefreshOrders: () => void;
  onAcknowledgeCall: (id: string) => void;
  // Set by Dashboard.tsx when a staff member clicks a notification — jumps
  // to the right section and highlights the specific row it's about,
  // requested 2026-09-19 right after the notification feature itself.
  focusRequest: KitchenFocusRequest | null;
  onFocusHandled: () => void;
}

const HIGHLIGHT_DURATION_MS = 4000;

// API Specification §7.3: the kitchen side updates order_items.status
// directly via PostgREST, not through an Edge Function — RLS
// (staff_manage_own_restaurant_order_items) is the only gate needed. The
// status_updated_at column updates itself via trg_order_item_status_updated_at
// (20260914100000), so this never needs to set it explicitly.
async function advanceStatus(id: string, next: 'ready' | 'served', onDone: () => void) {
  await supabase.from('order_items').update({ status: next }).eq('id', id);
  onDone();
}

// A diner's cancellation is instant and final the moment they request it —
// restaurant policy never lets it wait on the kitchen (2026-09-19). All the
// kitchen decides, afterward, is a pure inventory bookkeeping question:
// were the ingredients already used, or can they go back on the shelf? This
// is a function call rather than a plain PostgREST update because it also
// needs to coordinate the restock; record_cancellation_inventory_decision
// runs as the caller (security invoker), so the same staff_manage_own_
// restaurant_order_items RLS still gates it, exactly like the plain updates
// above — and it never touches status, since the item is already cancelled.
async function recordCancellationDecision(id: string, restock: boolean, onDone: () => void) {
  await supabase.rpc('record_cancellation_inventory_decision', { p_order_item_id: id, p_restock: restock });
  onDone();
}

function elapsedMinutes(placedAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(placedAt).getTime()) / 60000));
}

function statusLabelKey(status: KitchenItemStatus): TranslationKey {
  if (status === 'ready') return 'kitchenStatusReady';
  if (status === 'served') return 'kitchenStatusServed';
  if (status === 'cancelled') return 'kitchenStatusCancelled';
  return 'kitchenStatusInProgress';
}

// One shared mapping, used by both the active queue and history tables —
// they used to compute this independently (active: ready-or-not; history:
// served-or-cancelled-or-not), which is exactly how they drifted apart: a
// diner-visible bug where the same 'ready' status rendered green in the
// active queue but yellow in history, found by the user 2026-09-19.
// Yellow = still being worked on, green = a good/complete outcome
// (ready or served — distinguished from each other by their text label,
// not color), red = cancelled.
function statusPillClasses(status: KitchenItemStatus): string {
  if (status === 'ready' || status === 'served') return 'bg-success-soft text-success';
  if (status === 'cancelled') return 'bg-danger-soft text-danger';
  return 'bg-warning-soft text-warning';
}

// Traffic-light coloring for the active queue's elapsed-time column
// (requested 2026-09-19 alongside the FIFO queue-position column). Only
// meaningful while a dish is still being cooked and has a configured
// prep_time_minutes — once it's 'ready' the cooking phase is over (the
// status pill's own green already says "done", so freezing the timer here
// avoids a confusing red "elapsed" next to a green "ready"), and a dish
// with no prep time set never gets a false/default color.
function elapsedTimeClasses(item: KitchenOrderItem): string {
  if (item.status !== 'in_progress' || item.prepTimeMinutes === null) return 'text-muted-foreground';
  const ratio = elapsedMinutes(item.placedAt) / item.prepTimeMinutes;
  if (ratio <= 1) return 'text-success';
  if (ratio <= 1.5) return 'text-warning';
  return 'text-danger';
}

export function KitchenScreen({ restaurantId, items, waiterCalls, onRefreshOrders, onAcknowledgeCall, focusRequest, onFocusHandled }: Props) {
  const { t } = useI18n();
  const [printItem, setPrintItem] = useState<KitchenOrderItem | null>(null);
  const [section, setSection] = useState<'active' | 'history'>('active');
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

  // Cancelled-but-undecided items are fetched by useOrders (they're a live,
  // actionable queue, not filed-away history) but rendered in their own
  // banner rather than mixed into the cooking queue below — the kitchen
  // action here is "record what happened to the ingredients", nothing to do
  // with cook/ready/serve.
  const activeItems = items.filter((item) => item.status !== 'cancelled');
  const pendingCancellations = items.filter((item) => item.status === 'cancelled' && item.cancellationRestocked === null);

  // A cancellation notification always names an order_item directly, and a
  // cancelled item always lives in history — no lookup needed, just jump
  // there. A new-order notification names the whole order instead (one
  // notification can cover several dishes); pick whichever of that order's
  // items is still in the active queue, which is true in the overwhelming
  // common case (clicked shortly after the order comes in) — if every item
  // from that order has already moved on (served/cancelled) by the time the
  // notification is clicked, fall back to history with no specific row
  // highlighted rather than silently doing nothing.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.orderItemId) {
      setSection('history');
      setHighlightedItemId(focusRequest.orderItemId);
    } else if (focusRequest.orderId) {
      const match = activeItems.find((item) => item.orderId === focusRequest.orderId);
      if (match) {
        setSection('active');
        setHighlightedItemId(match.id);
      } else {
        setSection('history');
        setHighlightedItemId(null);
      }
    }
    onFocusHandled();
    const timer = setTimeout(() => setHighlightedItemId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  return (
    <div className="space-y-4">
      {pendingCancellations.length > 0 && (
        <div className="card border-l-4 border-l-danger p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('kitchenPendingCancellationsHeading')}</h2>
          <div className="space-y-2">
            {pendingCancellations.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded bg-danger-soft px-3 py-2 text-sm">
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-danger">
                  {item.barTicketNumber !== null
                    ? `${t('kitchenBarTicketLabel')} #${String(item.barTicketNumber).padStart(4, '0')}`
                    : `${t('kitchenTableLabel')} ${item.tableNumber}`}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {item.quantity}× {item.dishName}
                </span>
                <button
                  type="button"
                  onClick={() => void recordCancellationDecision(item.id, true, onRefreshOrders)}
                  className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  {t('kitchenConfirmCancelRestock')}
                </button>
                <button
                  type="button"
                  onClick={() => void recordCancellationDecision(item.id, false, onRefreshOrders)}
                  className="shrink-0 rounded border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
                >
                  {t('kitchenConfirmCancelNoRestock')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {waiterCalls.length > 0 && (
        <div className="card border-l-4 border-l-danger p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('kitchenWaiterCallsHeading')}</h2>
          <div className="space-y-2">
            {waiterCalls.map((call) => (
              <div key={call.id} className="flex items-center justify-between rounded bg-danger-soft px-3 py-2 text-sm">
                <span className="font-medium text-ink">
                  {t('kitchenTableLabel')} {call.tableNumber}
                  {call.reason ? ` · ${call.reason}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onAcknowledgeCall(call.id)}
                  className="rounded bg-white px-3 py-1 text-xs font-medium text-danger hover:bg-surface-2"
                >
                  {t('kitchenAcknowledgeCall')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-6">
        <h1 className="mb-1 text-lg font-bold text-ink">{t('kitchenTitle')}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{t('kitchenSubtitle')}</p>

        <div className="mb-4 inline-flex rounded border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSection('active')}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${section === 'active' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
          >
            {t('kitchenActiveTab')}
          </button>
          <button
            type="button"
            onClick={() => setSection('history')}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${section === 'history' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
          >
            {t('kitchenHistoryTab')}
          </button>
        </div>

        {section === 'active' ? (
          activeItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('kitchenEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnQueuePosition')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnTableOrTicket')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnGeneralAccount')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnPersonalAccount')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnDish')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnDetails')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnElapsed')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnStatus')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((item, index) => (
                    <tr
                      key={item.id}
                      ref={(el) => {
                        if (el && item.id === highlightedItemId) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      className={`border-b border-border transition-colors last:border-0 ${item.id === highlightedItemId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
                    >
                      <td className="px-2 py-2.5 tabular-nums font-medium text-ink">{index + 1}</td>
                      <td className="px-2 py-2.5">
                        {/* A bar order's badge shows the pickup ticket, not
                            the (fixed, non-informative) "בר" table
                            identifier — that's the whole point of the
                            ticket: it's what staff and the diner actually
                            match at handoff. */}
                        <span
                          className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            item.barTicketNumber !== null ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent'
                          }`}
                        >
                          {item.barTicketNumber !== null
                            ? `${t('kitchenBarTicketLabel')} #${String(item.barTicketNumber).padStart(4, '0')}`
                            : `${t('kitchenTableLabel')} ${item.tableNumber}`}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.sessionAccountNumber ?? '—'}</td>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.subAccountNumber ?? '—'}</td>
                      <td className="px-2 py-2.5 font-medium text-ink">
                        {item.quantity}× {item.dishName}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{[item.sizeName, item.modifierSummary].filter(Boolean).join(' · ') || '—'}</td>
                      <td className={`px-2 py-2.5 tabular-nums text-xs font-medium ${elapsedTimeClasses(item)}`}>{t('kitchenElapsedMinutes').replace('{minutes}', String(elapsedMinutes(item.placedAt)))}</td>
                      <td className="px-2 py-2.5">
                        <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClasses(item.status)}`}>
                          {item.status === 'ready' ? t('kitchenStatusReady') : t('kitchenStatusInProgress')}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap gap-2">
                          {item.barTicketNumber !== null && (
                            <button
                              type="button"
                              onClick={() => setPrintItem(item)}
                              className="shrink-0 rounded border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                            >
                              {t('kitchenPrintLabel')}
                            </button>
                          )}
                          {item.status === 'in_progress' ? (
                            <button
                              type="button"
                              onClick={() => void advanceStatus(item.id, 'ready', onRefreshOrders)}
                              className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                            >
                              {t('kitchenMarkReady')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void advanceStatus(item.id, 'served', onRefreshOrders)}
                              className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                            >
                              {t('kitchenMarkServed')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <OrderHistorySection restaurantId={restaurantId} highlightedItemId={highlightedItemId} />
        )}
      </div>

      {printItem && printItem.barTicketNumber !== null && (
        <BarTicketLabelModal ticketNumber={printItem.barTicketNumber} displayName={printItem.barDisplayName} onClose={() => setPrintItem(null)} />
      )}
    </div>
  );
}

type SortKey = 'dateDesc' | 'dateAsc' | 'dishName';

// The user's own request, right after seeing a cancelled item vanish from
// the active queue with no way to look it back up: a full history of every
// order ever placed (not just active ones), with filters (dish name,
// status, date range) and sorting — plus, for a cancelled row, whether the
// kitchen chose to restock or not (cancellation_restocked), since that was
// exactly the "where is this documented?" gap the question surfaced.
function OrderHistorySection({ restaurantId, highlightedItemId }: { restaurantId: string; highlightedItemId: string | null }) {
  const { t } = useI18n();
  const { loading, items } = useOrderHistory(restaurantId);
  const [dishNameFilter, setDishNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | KitchenItemStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dateDesc');

  const filteredAndSorted = useMemo(() => {
    const nameQuery = dishNameFilter.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const toTime = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : null;

    const filtered = items.filter((item) => {
      if (nameQuery && !item.dishName.toLowerCase().includes(nameQuery)) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      const placedTime = new Date(item.placedAt).getTime();
      if (fromTime !== null && placedTime < fromTime) return false;
      if (toTime !== null && placedTime > toTime) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortKey === 'dateDesc') sorted.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
    else if (sortKey === 'dateAsc') sorted.sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime());
    else sorted.sort((a, b) => a.dishName.localeCompare(b.dishName, 'he'));
    return sorted;
  }, [items, dishNameFilter, statusFilter, dateFrom, dateTo, sortKey]);

  const statusOptions: { value: 'all' | KitchenItemStatus; labelKey: TranslationKey }[] = [
    { value: 'all', labelKey: 'kitchenHistoryStatusAll' },
    { value: 'in_progress', labelKey: 'kitchenStatusInProgress' },
    { value: 'ready', labelKey: 'kitchenStatusReady' },
    { value: 'served', labelKey: 'kitchenStatusServed' },
    { value: 'cancelled', labelKey: 'kitchenStatusCancelled' },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-medium text-ink">{t('kitchenHistoryDishNameFilterLabel')}</label>
          <input
            type="text"
            value={dishNameFilter}
            onChange={(e) => setDishNameFilter(e.target.value)}
            placeholder={t('kitchenHistoryDishNameFilterPlaceholder')}
            className="w-full rounded border border-border px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{t('kitchenHistoryStatusFilterLabel')}</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | KitchenItemStatus)}
            className="rounded border border-border px-2 py-1.5 text-xs"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{t('kitchenHistoryDateFromLabel')}</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-border px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{t('kitchenHistoryDateToLabel')}</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-border px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{t('kitchenHistorySortLabel')}</label>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="rounded border border-border px-2 py-1.5 text-xs">
            <option value="dateDesc">{t('kitchenHistorySortDateDesc')}</option>
            <option value="dateAsc">{t('kitchenHistorySortDateAsc')}</option>
            <option value="dishName">{t('kitchenHistorySortDishName')}</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : filteredAndSorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kitchenHistoryEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnTableOrTicket')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnGeneralAccount')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnPersonalAccount')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnDish')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnDetails')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnDate')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnStatus')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnCancellationReason')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnRestocked')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((item) => (
                <tr
                  key={item.id}
                  ref={(el) => {
                    if (el && item.id === highlightedItemId) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className={`border-b border-border transition-colors last:border-0 ${item.id === highlightedItemId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
                >
                  <td className="px-2 py-2.5">
                    <span
                      className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.barTicketNumber !== null ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      {item.barTicketNumber !== null
                        ? `${t('kitchenBarTicketLabel')} #${String(item.barTicketNumber).padStart(4, '0')}`
                        : `${t('kitchenTableLabel')} ${item.tableNumber}`}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.sessionAccountNumber ?? '—'}</td>
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.subAccountNumber ?? '—'}</td>
                  <td className="px-2 py-2.5 font-medium text-ink">
                    {item.quantity}× {item.dishName}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">{[item.sizeName, item.modifierSummary].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">{new Date(item.placedAt).toLocaleString('he-IL')}</td>
                  <td className="px-2 py-2.5">
                    <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClasses(item.status)}`}>{t(statusLabelKey(item.status))}</span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">{item.status === 'cancelled' ? (item.cancellationReason ?? '—') : '—'}</td>
                  <td className="px-2 py-2.5">
                    {item.status === 'cancelled' && item.cancellationRestocked !== null ? (
                      <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${item.cancellationRestocked ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
                        {item.cancellationRestocked ? t('kitchenCancellationRestocked') : t('kitchenCancellationNotRestocked')}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
