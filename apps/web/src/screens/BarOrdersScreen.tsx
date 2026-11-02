import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { KitchenItemStatus, KitchenOrderItem } from '../lib/useOrders';
import { useOrderHistory } from '../lib/useOrderHistory';
import { useBarStatus, followScheduleLabelKey, type BarManualOverride } from '../lib/useBarStatus';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { BarTicketLabelModal } from '../components/BarTicketLabelModal';
import { SearchIcon } from '../components/Icons';
import {
  EditedAttentionBadge,
  advanceStatus,
  recordCancellationDecision,
  elapsedMinutes,
  statusLabelKey,
  statusPillClasses,
  elapsedTimeClasses,
} from './KitchenScreen';

interface Props {
  restaurantId: string;
  items: KitchenOrderItem[];
  onRefreshOrders: () => void;
}

// The bar's own dedicated screen (2026-11-01, per explicit request) — the
// bar is physically separate and runs independently from the kitchen, so
// its orders get their own focused view instead of being mixed into
// KitchenScreen's queue. That screen is deliberately left untouched and
// keeps showing EVERY order (bar included): the decision here was to ADD a
// bar-specific view, not remove bar visibility from the kitchen staff who
// may still be the ones actually cooking a bar-ordered dish. Column set,
// status colors/labels, active+history+pending-cancellation structure and
// the print-ticket flow are all copied from KitchenScreen.tsx (full feature
// parity, per explicit request). General/personal-account columns ARE kept
// (real bug fix 2026-11-01, matching AccountsScreen.tsx/useAccounts.ts's
// own convention): every bar order still belongs to a real table_session
// with its own general account number, and its personal identity is the
// padded pickup-ticket number instead of a sub_account_number — not
// "neither column applies", which is what an earlier version of this
// screen incorrectly assumed. The Table/Ticket column itself just answers
// "where from" (always "בר" here, since this whole screen is bar-only) —
// the ticket number lives in the personal-account column instead.
export function BarOrdersScreen({ restaurantId, items, onRefreshOrders }: Props) {
  const { t } = useI18n();
  const [printItem, setPrintItem] = useState<KitchenOrderItem | null>(null);
  const [section, setSection] = useState<'active' | 'history'>('active');

  const barItems = items.filter((item) => item.barTicketNumber !== null);
  const activeItems = barItems.filter((item) => item.status !== 'cancelled');
  const pendingCancellations = barItems.filter((item) => item.status === 'cancelled' && item.cancellationRestocked === null);

  return (
    <div className="space-y-4">
      <BarStatusCard restaurantId={restaurantId} />

      {pendingCancellations.length > 0 && (
        <div className="card border-l-4 border-l-danger p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('kitchenPendingCancellationsHeading')}</h2>
          <div className="space-y-2">
            {pendingCancellations.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded bg-danger-soft px-3 py-2 text-sm">
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-danger">
                  {t('kitchenBarTicketLabel')} #{String(item.barTicketNumber).padStart(4, '0')}
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

      <div className="card p-6">
        <h1 className="mb-1 text-lg font-bold text-ink">{t('barOrdersTitle')}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{t('barOrdersSubtitle')}</p>

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
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnSpecialRequest')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnElapsed')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnStatus')}</th>
                    <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((item, index) => (
                    <tr key={item.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-2">
                      <td className="px-2 py-2.5 tabular-nums font-medium text-ink">{index + 1}</td>
                      <td className="px-2 py-2.5">
                        <span className="inline-block shrink-0 whitespace-nowrap rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{t('kitchenBarLocationLabel')}</span>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.sessionAccountNumber ?? '—'}</td>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.subAccountNumber ?? '—'}</td>
                      <td className="px-2 py-2.5 font-medium text-ink">
                        {item.quantity}× {item.dishName}
                        {item.editedAt && <EditedAttentionBadge t={t} />}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{[item.sizeName, item.modifierSummary].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{item.specialRequest ?? '—'}</td>
                      <td className={`px-2 py-2.5 tabular-nums text-xs font-medium ${elapsedTimeClasses(item)}`}>{t('kitchenElapsedMinutes').replace('{minutes}', String(elapsedMinutes(item.placedAt)))}</td>
                      <td className="px-2 py-2.5">
                        <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClasses(item.status)}`}>
                          {item.status === 'ready' ? t('kitchenStatusReady') : t('kitchenStatusInProgress')}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPrintItem(item)}
                            className="shrink-0 rounded border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                          >
                            {t('kitchenPrintLabel')}
                          </button>
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
          <BarOrderHistorySection restaurantId={restaurantId} />
        )}
      </div>

      {printItem && printItem.barTicketNumber !== null && (
        <BarTicketLabelModal ticketNumber={printItem.barTicketNumber} displayName={printItem.barDisplayName} onClose={() => setPrintItem(null)} />
      )}
    </div>
  );
}

// Bar active/inactive status (2026-11-02, hybrid schedule+override). This
// card is the staff-facing quick daily toggle — the actual weekly schedule
// is edited separately in RestaurantDetailsForm.tsx's own bar-hours
// section. Status computation (and its auto-close side effect) is shared
// with TableStatusBoard's own bar row via useBarStatus.
function BarStatusCard({ restaurantId }: { restaurantId: string }) {
  const { t } = useI18n();
  const { active, override, hasBarHours, hasGeneralHours, refresh } = useBarStatus(restaurantId);
  const [busy, setBusy] = useState(false);

  async function handleSetOverride(value: BarManualOverride) {
    setBusy(true);
    const { error } = await supabase.from('restaurants').update({ bar_manual_override: value }).eq('id', restaurantId);
    if (!error) await refresh();
    setBusy(false);
  }

  const OVERRIDE_OPTIONS: { value: BarManualOverride; labelKey: TranslationKey }[] = [
    { value: null, labelKey: followScheduleLabelKey(hasBarHours, hasGeneralHours) },
    { value: 'open', labelKey: 'barOverrideOpenNowLabel' },
    { value: 'closed', labelKey: 'barOverrideCloseNowLabel' },
  ];

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-success' : 'bg-danger'}`} />
        <span className="text-sm font-semibold text-ink">{active ? t('barStatusActiveLabel') : t('barStatusInactiveLabel')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded border border-border p-0.5 text-xs">
          {OVERRIDE_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              disabled={busy}
              onClick={() => void handleSetOverride(opt.value)}
              className={`rounded px-3 py-1.5 font-medium transition-colors disabled:opacity-50 ${
                override === opt.value ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <p className="w-full text-[10px] text-muted-foreground">{t('barOverrideHint')}</p>
    </div>
  );
}

type SortKey = 'dateDesc' | 'dateAsc' | 'dishName';

// Same filters/sort/columns as KitchenScreen.tsx's own OrderHistorySection,
// narrowed to bar-ticket rows only (barTicketNumber !== null) — a separate
// component, not a shared one taking a filter prop, since the Table/Ticket
// column's own content differs (always "בר" here — see BarOrdersScreen's
// own top comment for why the general/personal-account columns stay).
function BarOrderHistorySection({ restaurantId }: { restaurantId: string }) {
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
      if (item.barTicketNumber === null) return false;
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
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={dishNameFilter}
              onChange={(e) => setDishNameFilter(e.target.value)}
              placeholder={t('kitchenHistoryDishNameFilterPlaceholder')}
              className="w-full rounded border border-border px-2 py-1.5 ps-2 pe-7 text-xs"
            />
          </div>
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
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnSpecialRequest')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnDate')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnStatus')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnCancellationReason')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('kitchenColumnRestocked')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((item) => (
                <tr key={item.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-2">
                  <td className="px-2 py-2.5">
                    <span className="inline-block shrink-0 whitespace-nowrap rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{t('kitchenBarLocationLabel')}</span>
                  </td>
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.sessionAccountNumber ?? '—'}</td>
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{item.subAccountNumber ?? '—'}</td>
                  <td className="px-2 py-2.5 font-medium text-ink">
                    {item.quantity}× {item.dishName}
                    {item.editedAt && <EditedAttentionBadge t={t} />}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">{[item.sizeName, item.modifierSummary].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">{item.specialRequest ?? '—'}</td>
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
