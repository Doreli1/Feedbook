import { Fragment, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAccounts, fetchPaymentEvents, type AccountRow, type AccountOrderItem, type PaymentEvent } from '../lib/useAccounts';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { ChevronDownIcon, CheckIcon, CloseIcon, ClockIcon } from '../components/Icons';

interface Props {
  session: Session;
  restaurantId: string;
}

type StaffRole = 'manager' | 'waiter' | 'kitchen';

const EVENT_TYPE_LABEL_KEYS: Record<PaymentEvent['eventType'], TranslationKey> = {
  charge: 'accountsEventCharge',
  refund: 'accountsEventRefund',
  tip_added: 'accountsEventTipAdded',
  tip_adjusted: 'accountsEventTipAdjusted',
  cancellation_refund: 'accountsEventCancellationRefund',
};

const ITEM_STATUS_LABEL_KEYS: Record<AccountOrderItem['status'], TranslationKey> = {
  in_progress: 'accountsItemStatusInProgress',
  ready: 'accountsItemStatusReady',
  served: 'accountsItemStatusServed',
  cancelled: 'accountsItemStatusCancelled',
};

function formatAmount(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Accounting notation for a cancelled line (2026-10-21, per explicit
// request): parentheses, not a minus sign — the conventional way to mark a
// reduction from the account total, distinct from a plain negative number.
function formatCancelledAmount(amount: number): string {
  return `(₪${formatAmount(amount)})`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const PAYMENT_METHOD_LABEL_KEYS: Record<'credit_card' | 'cash', TranslationKey> = {
  credit_card: 'accountsPaymentMethodCreditCard',
  cash: 'accountsPaymentMethodCash',
};

// "משך ביקור" (session duration, 2026-10-21 — for operational analysis, per
// explicit request) — open/closed) both compute against "now" as the end
// point until closed_at exists, mirroring the open-ended-elapsed pattern
// already used in ServiceScreen.tsx's own formatElapsed.
function formatDuration(openedAt: string, closedAt: string | null, t: (key: TranslationKey) => string): string {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.round((end - start) / 60000));
  if (totalMinutes < 60) {
    return t('accountsDurationMinutesOnly').replace('{minutes}', String(totalMinutes));
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return t('accountsDurationHoursMinutes').replace('{hours}', String(hours)).replace('{minutes}', String(minutes));
}

// Small reason-prompt modal — same backdrop+card language as
// ConfirmDialog.tsx, but with a required free-text field (the Edge Function
// rejects an empty reason), so built separately rather than overloading
// that component's fixed title+description shape.
function CancelReasonModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t, dir } = useI18n();
  const [reason, setReason] = useState('');

  useEffect(() => {
    // Resets the draft each time the modal reopens — not computed during
    // render since `reason` must still track typing while open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setReason('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div dir={dir} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="mb-3 text-base font-bold text-ink">{t('accountsCancelItemTitle')}</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('accountsCancelReasonPlaceholder')}
          autoFocus
          rows={3}
          className="mb-4 w-full rounded border border-border px-3 py-2 text-sm text-ink"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2">
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={reason.trim() === ''}
            onClick={() => onConfirm(reason.trim())}
            className="rounded bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
          >
            {t('accountsCancelItemConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemStatusBadge({ status }: { status: AccountOrderItem['status'] }) {
  const { t } = useI18n();
  const classes = status === 'cancelled' ? 'bg-danger-soft text-danger' : status === 'ready' || status === 'served' ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${classes}`}>{t(ITEM_STATUS_LABEL_KEYS[status])}</span>;
}

// "סטטוס חשבון" column (master row) — distinct from ItemStatusBadge (per-
// dish prep status, shown only inside the expanded sub-account detail).
// Takes the real settlement status ('open' | 'paid'), not the raw
// table_sessions.status — see AccountRow.paymentStatus's own comment for
// why those two are deliberately different values.
function PaymentStatusBadge({ status }: { status: 'open' | 'paid' }) {
  const { t } = useI18n();
  const classes = status === 'open' ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${classes}`}>
      {status === 'open' ? <ClockIcon className="h-3 w-3" /> : <CheckIcon className="h-3 w-3" />}
      {t(status === 'open' ? 'accountsSessionOpen' : 'accountsSessionClosed')}
    </span>
  );
}

// Table-row layout (2026-10-21, per explicit request — replaces the earlier
// flex-row list, then flattened out of its own per-participant box after
// design feedback — see this function's own comment below). sessionClosed
// disables the cancel action entirely: once an account is closed it's
// already paid, and any credit from then on goes through the clearing
// system itself, not this module (see 12.Feedbook_Accounts_Module_Spec v3
// §4 and today's clarification).
// Grandchild level (2026-10-21, per explicit request): one diner's own item
// detail, in its own self-contained table — reached by expanding that
// diner's row in ParticipantSummaryRow below. No longer a group-label row
// inside one shared cross-diner table (the previous design) — now that
// every diner owns a dedicated expand area, the table itself IS the
// separator between diners, so the earlier border-t-2 hack is gone too.
function ParticipantItemTable({
  participant,
  sessionClosed,
  myRole,
  onRequestCancel,
  onDecide,
}: {
  participant: AccountRow['participants'][number];
  sessionClosed: boolean;
  myRole: StaffRole | null;
  onRequestCancel: (itemId: string) => void;
  onDecide: (requestId: string, decision: 'approve' | 'reject') => void;
}) {
  const { t } = useI18n();
  const canAct = !sessionClosed && (myRole === 'manager' || myRole === 'waiter');
  const items = [...participant.items].sort((a, b) => a.dishName.localeCompare(b.dishName, 'he'));

  return (
    <div className="overflow-hidden rounded border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnDish')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnQuantity')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnUnitPrice')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnLineTotal')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnStatus')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnCancellationReason')}</th>
            {!sessionClosed && <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnAction')}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const unitPrice = item.unitPrice + item.modifierTotal;
            const lineTotal = unitPrice * item.quantity;
            const isCancelled = item.status === 'cancelled';
            const canCancelThis = canAct && !isCancelled && !item.pendingCancellationRequestId;
            return (
              <tr key={item.id} className="border-b border-border last:border-b-0">
                <td className={`px-3 py-2 ${isCancelled ? 'text-muted-foreground line-through' : 'text-ink'}`}>
                  {item.dishName}
                  {item.sizeOptionName && <span className="text-muted-foreground"> ({item.sizeOptionName})</span>}
                </td>
                <td className="px-3 py-2 text-ink">{item.quantity}</td>
                <td className="px-3 py-2 text-ink">₪{formatAmount(unitPrice)}</td>
                <td className={`px-3 py-2 font-medium ${isCancelled ? 'text-danger' : 'text-ink'}`}>
                  {isCancelled ? formatCancelledAmount(lineTotal) : `₪${formatAmount(lineTotal)}`}
                </td>
                <td className="px-3 py-2">
                  <ItemStatusBadge status={item.status} />
                </td>
                <td className="px-3 py-2 text-xs italic text-muted-foreground">{isCancelled ? (item.cancellationReason ?? '—') : '—'}</td>
                {!sessionClosed && (
                  <td className="px-3 py-2">
                    {item.pendingCancellationRequestId ? (
                      myRole === 'manager' ? (
                        <div className="flex items-center gap-1">
                          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">{t('accountsPendingApprovalBadge')}</span>
                          <button type="button" onClick={() => onDecide(item.pendingCancellationRequestId!, 'approve')} aria-label={t('accountsApproveAction')} className="rounded p-1 text-success hover:bg-success-soft">
                            <CheckIcon className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => onDecide(item.pendingCancellationRequestId!, 'reject')} aria-label={t('accountsRejectAction')} className="rounded p-1 text-danger hover:bg-danger-soft">
                            <CloseIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">{t('accountsPendingApprovalBadge')}</span>
                      )
                    ) : canCancelThis ? (
                      <button type="button" onClick={() => onRequestCancel(item.id)} className="rounded border border-danger px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-soft">
                        {t('accountsCancelItemTitle')}
                      </button>
                    ) : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Child level (2026-10-21, per explicit request): one row per diner,
// structured like a miniature version of the master row — a "מזהה חשבון
// אישי" identifier first, then that diner's own payment share and tip as
// their own columns (feeding a future "קופת טיפים" aggregate). Expanding a
// diner reveals ParticipantItemTable above — the grandchild level, in the
// same column shape as the master table's own item columns.
function ParticipantSummaryRow({
  participant,
  isBar,
  expanded,
  onToggle,
  sessionClosed,
  myRole,
  onRequestCancel,
  onDecide,
}: {
  participant: AccountRow['participants'][number];
  isBar: boolean;
  expanded: boolean;
  onToggle: () => void;
  sessionClosed: boolean;
  myRole: StaffRole | null;
  onRequestCancel: (itemId: string) => void;
  onDecide: (requestId: string, decision: 'approve' | 'reject') => void;
}) {
  const { t, dir } = useI18n();
  return (
    <>
      <tr className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2" onClick={onToggle}>
        <td className="px-3 py-2 text-sm font-bold text-ink">
          {isBar ? t('accountsBarTicketLabel') : t('accountsSubAccountLabel')} {participant.displayNumber}
        </td>
        <td className="px-3 py-2 text-sm text-ink">₪{formatAmount(participant.totalCost)}</td>
        <td className="px-3 py-2 text-sm text-ink">₪{formatAmount(participant.tipAmount)}</td>
        <td className="px-3 py-2 text-sm text-ink">{participant.paymentMethod ? t(PAYMENT_METHOD_LABEL_KEYS[participant.paymentMethod]) : '—'}</td>
        <td className="px-3 py-2">
          <PaymentStatusBadge status={participant.paymentStatus} />
        </td>
        {/* Expand chevron moved to the far side (2026-10-22, per explicit
            request) — was the first column, now the last. */}
        <td className="px-2 py-2">
          <ChevronDownIcon
            aria-label={t('accountsExpandDetailsLabel')}
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? '' : dir === 'rtl' ? 'rotate-90' : '-rotate-90'}`}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border last:border-b-0">
          <td colSpan={6} className="bg-surface-2/40 p-3" onClick={(e) => e.stopPropagation()}>
            <ParticipantItemTable
              participant={participant}
              sessionClosed={sessionClosed}
              myRole={myRole}
              onRequestCancel={onRequestCancel}
              onDecide={onDecide}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function EventJournalTable({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<PaymentEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPaymentEvents(sessionId).then((data) => {
      if (!cancelled) setEvents(data);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (events === null) return <p className="py-3 text-sm text-muted-foreground">{t('loading')}</p>;
  if (events.length === 0) return <p className="py-3 text-sm text-muted-foreground">{t('accountsNoEventsYet')}</p>;

  return (
    <div className="overflow-hidden rounded border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnDate')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnEventType')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnAmount')}</th>
            <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnReason')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(e.createdAt)}</td>
              <td className="px-3 py-2 text-ink">{t(EVENT_TYPE_LABEL_KEYS[e.eventType])}</td>
              <td className="px-3 py-2 font-medium text-ink">₪{formatAmount(e.amount)}</td>
              <td className="px-3 py-2 text-xs italic text-muted-foreground">{e.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Number of columns in the master table's header row — the expand-detail
// row (AccountDetailPanel, below) spans all of them via colSpan.
const MASTER_COL_COUNT = 10;

// Full sub-account detail revealed by expanding a master row (2026-10-21,
// per explicit request: "בפתיחה של כל שורה, יוצגו פירוט מלא של תתי חשבונות
// אישיים") — same "לפי סועד"/"יומן אירועים" content the old per-session
// card used to own, now rendered as one wide row inside the shared master
// <table> instead of its own bordered card.
function AccountDetailPanel({
  row,
  myRole,
  onRequestCancellation,
  onDecideCancellation,
}: {
  row: AccountRow;
  myRole: StaffRole | null;
  onRequestCancellation: (orderItemId: string, reason: string) => void;
  onDecideCancellation: (requestId: string, decision: 'approve' | 'reject') => void;
}) {
  const { t } = useI18n();
  const [innerTab, setInnerTab] = useState<'participants' | 'events'>('participants');
  const [cancelTargetItemId, setCancelTargetItemId] = useState<string | null>(null);
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  // row.paymentStatus (the bottom-up aggregate), not row.sessionStatus (the
  // raw DB flag) — 2026-10-22, per explicit correction: the reason to hide
  // the cancel-item action is that the account was actually PAID, which
  // sessionStatus alone can't guarantee (see AccountRow.paymentStatus).
  const sessionClosed = row.paymentStatus === 'paid';

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{t('accountsParticipantCountLabel')}: {row.participants.length}</span>
        <span>{t('accountsDurationLabel')}: {formatDuration(row.openedAt, row.closedAt, t)}</span>
        {row.cancelledCount > 0 && (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">
            {t('accountsCancelledCountLabel')} {row.cancelledCount}
          </span>
        )}
      </div>

      <div className="mb-3 flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setInnerTab('participants')}
          className={`px-3 py-2 text-xs font-semibold ${innerTab === 'participants' ? 'border-b-2 border-accent text-accent' : 'text-muted-foreground'}`}
        >
          {t('accountsByParticipantTab')}
        </button>
        <button
          type="button"
          onClick={() => setInnerTab('events')}
          className={`px-3 py-2 text-xs font-semibold ${innerTab === 'events' ? 'border-b-2 border-accent text-accent' : 'text-muted-foreground'}`}
        >
          {t('accountsEventJournalTab')}
        </button>
      </div>

      {innerTab === 'participants' ? (
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnPersonalAccountId')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnPaymentShare')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnTip')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnPaymentMethod')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnSessionStatus')}</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {row.participants.map((p) => (
                <ParticipantSummaryRow
                  key={p.participantId}
                  participant={p}
                  isBar={row.isBar}
                  expanded={expandedParticipantId === p.participantId}
                  onToggle={() => setExpandedParticipantId(expandedParticipantId === p.participantId ? null : p.participantId)}
                  sessionClosed={sessionClosed}
                  myRole={myRole}
                  onRequestCancel={(itemId) => setCancelTargetItemId(itemId)}
                  onDecide={onDecideCancellation}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EventJournalTable sessionId={row.sessionId} />
      )}

      <CancelReasonModal
        open={cancelTargetItemId !== null}
        onCancel={() => setCancelTargetItemId(null)}
        onConfirm={(reason) => {
          if (cancelTargetItemId) onRequestCancellation(cancelTargetItemId, reason);
          setCancelTargetItemId(null);
        }}
      />
    </div>
  );
}

// One master row per table/session (2026-10-21, per explicit request —
// replaces the earlier per-session card): dish/qty/unit-price/line-total
// render as an aligned stack of lines within their own cell — the full
// per-participant breakdown only appears in AccountDetailPanel once the row
// expands (child level).
//
// Parent-level merging, after three rounds of explicit correction:
// 1st attempt: one line per raw order_item — on a real table with several
//   diners this meant dozens of duplicate "סטייק..." lines.
// 2nd attempt: merged purely by name, dropping size/price from the key
//   entirely — overcorrected: a dish WITH real serving sizes (different
//   unit prices) needs those kept as separate records too, since the price
//   difference is real information, not noise to collapse away.
// Final (this round): a dish line merges on (dish name, dish_size_option —
// "350 גרם" vs "700 גרם" — unit price); an add-on line merges on (modifier
// name, its own serving-variant format — "שליש חבית" vs "חצי חבית",
// modifier_option_serving_variants — price). Two instances of the exact
// same dish/size/price combine into one row with summed quantity; two
// different prices for what's otherwise the same dish/size (e.g. a
// discount applied once but not the other time) stay on separate rows,
// each still reading correctly since quantity × unit price = that row's
// own total. Cancelled items are excluded entirely at this level (not
// shown struck-through, not shown at all — "רק את מה שהוזמן"); cancellation
// detail only lives in AccountDetailPanel. Add-ons are NOT split into their
// own sub-list (2026-10-22, per explicit correction reversing the earlier
// "רשימה בפני עצמה" attempt) — dishes and add-ons sort together into one
// combined, alphabetically-ascending list.
interface MergedAccountLine {
  key: string;
  label: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

function mergeAccountItemsByDish(participants: AccountRow['participants']): MergedAccountLine[] {
  const merged = new Map<string, MergedAccountLine>();

  for (const participant of participants) {
    for (const item of participant.items) {
      if (item.status === 'cancelled') continue;

      const dishLabel = item.sizeOptionName ? `${item.dishName} (${item.sizeOptionName})` : item.dishName;
      // "dish:"/"addon:" key prefixes keep the two Maps' entries from ever
      // colliding when a dish and an unrelated add-on happen to share the
      // same label+price — they still render together, sorted as one list.
      const dishKey = `dish:${dishLabel}__${item.unitPrice}`;
      const existingDish = merged.get(dishKey);
      if (existingDish) {
        existingDish.quantity += item.quantity;
        existingDish.lineTotal += item.unitPrice * item.quantity;
      } else {
        merged.set(dishKey, { key: dishKey, label: dishLabel, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.unitPrice * item.quantity });
      }

      for (const modifier of item.modifiers) {
        if (modifier.priceDelta <= 0) continue;
        const addOnLabel = modifier.servingVariantName ? `${modifier.name} (${modifier.servingVariantName})` : modifier.name;
        const addOnKey = `addon:${addOnLabel}__${modifier.priceDelta}`;
        const existingAddOn = merged.get(addOnKey);
        if (existingAddOn) {
          existingAddOn.quantity += item.quantity;
          existingAddOn.lineTotal += modifier.priceDelta * item.quantity;
        } else {
          merged.set(addOnKey, { key: addOnKey, label: addOnLabel, quantity: item.quantity, unitPrice: modifier.priceDelta, lineTotal: modifier.priceDelta * item.quantity });
        }
      }
    }
  }

  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

// Real per-item <tr>s with rowSpan on the session-level cells (2026-10-22,
// per explicit correction) — replaces the single-<tr>-with-a-nested-<table>
// attempt. That nested table could keep its OWN rows aligned internally,
// but it was a second, independent table laid out inside one spanned <td>
// — its column widths had no relationship to the outer header's four
// separate <th> cells, so a value could land under the wrong-looking
// header purely from width drift between the two tables. Real sub-rows of
// the SAME outer <table> are the only construct where the header and the
// data are guaranteed to share column boundaries. The session-level cells
// (toggle, account id, table, status, payment method, tip, summary) use
// rowSpan to span every item row in the group, so the group still reads as
// one block per table/session.
function AccountSummaryRows({ row, expanded, onToggle }: { row: AccountRow; expanded: boolean; onToggle: () => void }) {
  const { t, dir } = useI18n();
  const lines = mergeAccountItemsByDish(row.participants);
  const rowCount = Math.max(lines.length, 1);
  // Plain CSS hover:bg-surface-2 only lights up the one <tr> under the
  // cursor — a rowSpanned cell (account id, table, status, etc.) belongs to
  // row 0's DOM node alone, so hovering any other item row in the group
  // left it (and every OTHER item row) white, even though the whole block
  // reads as one session visually (2026-10-22, per explicit report). JS
  // hover state shared across every row in this component instance is the
  // only way to highlight the group as a unit.
  const [isHovered, setIsHovered] = useState(false);

  return (
    <>
      {Array.from({ length: rowCount }, (_, i) => {
        const line = lines[i] as MergedAccountLine | undefined;
        return (
          <tr
            key={line?.key ?? 'empty'}
            className={`cursor-pointer border-b border-border ${isHovered ? 'bg-surface-2' : ''}`}
            onClick={onToggle}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {i === 0 && (
              <>
                {/* מזהה חשבון is the primary identifier (2026-10-22, per
                    explicit correction) — now comes before the table
                    number, not after it. */}
                <td className="px-3 py-3 text-sm font-bold text-ink" rowSpan={rowCount}>
                  #{row.sessionAccountNumber}
                </td>
                <td className="px-3 py-3 text-sm text-ink" rowSpan={rowCount}>
                  {t('tableNumberLabel')} {row.tableNumber}
                  {row.isBar && <span className="text-muted-foreground"> ({t('accountsBarLabel')})</span>}
                </td>
              </>
            )}
            <td className="px-3 py-2 text-ink">{line?.label ?? '—'}</td>
            <td className="px-3 py-2 text-ink">{line?.quantity ?? ''}</td>
            <td className="px-3 py-2 text-ink">{line ? `₪${formatAmount(line.unitPrice)}` : ''}</td>
            <td className="px-3 py-2 text-ink">{line ? `₪${formatAmount(line.lineTotal)}` : ''}</td>
            {i === 0 && (
              <>
                <td className="px-3 py-3" rowSpan={rowCount}>
                  <PaymentStatusBadge status={row.paymentStatus} />
                </td>
                <td className="px-3 py-3 text-sm text-ink" rowSpan={rowCount}>
                  ₪{formatAmount(row.totalTip)}
                </td>
                <td className="px-3 py-3" rowSpan={rowCount}>
                  <div className="flex flex-col gap-0.5 text-xs">
                    <span className="text-sm font-bold text-ink">{t('accountsSummaryTotalLabel')}: ₪{formatAmount(row.totalCost)}</span>
                    <span className="text-muted-foreground">{t('accountsSummaryTimeLabel')}: {formatTime(row.openedAt)}</span>
                  </div>
                </td>
                {/* Expand chevron moved to the far side (2026-10-22, per
                    explicit request) — was the first column, now the last. */}
                <td className="px-2 py-3" rowSpan={rowCount}>
                  <ChevronDownIcon
                    aria-label={t('accountsExpandDetailsLabel')}
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? '' : dir === 'rtl' ? 'rotate-90' : '-rotate-90'}`}
                  />
                </td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

// "חשבונות" module (PRD §5.1.5, App Flow §3.10, Backend Schema §6.5) —
// replaces the honest placeholder that lived here since 2026-10-13. See
// 12.Feedbook_Accounts_Module_Spec v3 for the full design.
export function AccountsScreen({ session, restaurantId }: Props) {
  const { t } = useI18n();
  const { loading, rows, requestCancellation, decideCancellation } = useAccounts(restaurantId);
  const [myRole, setMyRole] = useState<StaffRole | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('staff')
      .select('role')
      .eq('user_id', session.user.id)
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMyRole((data?.role as StaffRole) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id, restaurantId]);

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-lg font-bold text-ink">{t('accountsTitle')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('accountsSubtitle')}</p>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <div className="rounded bg-surface-2 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('accountsNoSessionsYet')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnAccountId')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnTable')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnItems')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnQuantity')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnUnitPrice')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnLineTotal')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnSessionStatus')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnTip')}</th>
                <th className="px-3 py-2 text-start text-sm font-bold text-ink">{t('accountsColumnSummary')}</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = expandedSessionId === row.sessionId;
                return (
                  <Fragment key={row.sessionId}>
                    <AccountSummaryRows
                      row={row}
                      expanded={expanded}
                      onToggle={() => setExpandedSessionId(expanded ? null : row.sessionId)}
                    />
                    {expanded && (
                      <tr className="border-b border-border bg-surface-2/40">
                        <td colSpan={MASTER_COL_COUNT}>
                          <AccountDetailPanel
                            row={row}
                            myRole={myRole}
                            onRequestCancellation={(itemId, reason) => void requestCancellation(itemId, reason)}
                            onDecideCancellation={(requestId, decision) => void decideCancellation(requestId, decision)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
