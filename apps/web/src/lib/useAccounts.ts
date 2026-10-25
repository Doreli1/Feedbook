import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface AccountOrderItem {
  id: string;
  dishName: string;
  // Dish's own serving-size choice, e.g. "350 גרם" vs "700 גרם" (Backend
  // Schema §3.1 dish_size_options — order_items.dish_size_option_id) —
  // null for a dish with no size options. Distinct from modifiers below:
  // picking a size changes which variant of the dish this IS and sets
  // unitPrice itself; a modifier is an optional customization layered on
  // top of whichever size was picked.
  sizeOptionName: string | null;
  quantity: number;
  unitPrice: number;
  modifierTotal: number;
  // Per-modifier breakdown (2026-10-21, per explicit request) — a modifier
  // with priceDelta > 0 is a paid add-on (e.g. a drink); 0 means it's a
  // free customization bundled into the dish price (dish_modifier_options'
  // own "0 = included, positive = paid add-on" convention). Used by the
  // master row to pull paid add-ons into their own separate list instead
  // of folding them into the dish's merged price. servingVariantName
  // mirrors sizeOptionName above but for a modifier's own serving format
  // (e.g. a beer add-on offered "שליש חבית" vs "חצי חבית" at different
  // prices — Backend Schema modifier_option_serving_variants).
  modifiers: { name: string; priceDelta: number; servingVariantName: string | null }[];
  status: 'in_progress' | 'ready' | 'served' | 'cancelled';
  cancellationReason: string | null;
  // Set when a waiter opened a cancellation request for this item that a
  // manager hasn't decided yet (request-order-item-cancellation's pending
  // path) — surfaced so the manager sees it needs a decision.
  pendingCancellationRequestId: string | null;
}

export interface AccountParticipant {
  participantId: string;
  // Table: the diner's own sub_account_number. Bar: the pickup-ticket
  // number instead, per PRD §5.1.5/App Flow §3.10 ("שורת בר מוצגת לפי
  // מספרי כרטיסי האיסוף... במקום מספרי חשבון-משנה אישיים").
  displayNumber: string;
  items: AccountOrderItem[];
  // This diner's own share of the bill — sum of their own non-cancelled
  // items only (same exclusion rule as AccountRow.totalCost), 2026-10-21
  // per explicit request ("נתח של סך התשלום לכל סועד").
  totalCost: number;
  // This diner's own tip (payment_participant_shares.tip_amount, keyed by
  // participant_id this time instead of summed per-session) — 2026-10-21,
  // per explicit request for a standalone, per-diner tip data point feeding
  // a future "קופת טיפים" (shared tip pool) aggregate and analytics. Always
  // 0 today for the same reason as AccountRow.totalTip: no real payment
  // flow writes these rows yet. Bar pseudo-participants (no stable
  // session_participants link across orders) always get 0 here too — the
  // bar doesn't track per-diner identity to begin with.
  tipAmount: number;
  // How THIS diner settled their own share (payments.payment_method,
  // resolved through their own payment_participant_shares row) — moved
  // here from AccountRow 2026-10-22, per explicit request: payment method
  // is naturally a per-diner fact (each participant can settle separately,
  // by_item or even), not a session-wide one. Always null today, same
  // reason as tipAmount; bar pseudo-participants always null too.
  paymentMethod: 'credit_card' | 'cash' | null;
  // This diner's own share status (payment_participant_shares.status) —
  // 2026-10-22, per explicit request to show "פתוח"/"שולם" per personal
  // account, not just at the session level. 'open' when there's no share
  // row yet (nothing paid) or it's still 'pending'; 'paid' once their share
  // is settled. Always 'open' today for the same reason as paymentMethod.
  paymentStatus: 'open' | 'paid';
}

export interface AccountRow {
  sessionId: string;
  isBar: boolean;
  tableNumber: string;
  sessionAccountNumber: string;
  // Raw table_sessions.status — reflects whether the session itself can
  // still take orders, nothing more. NOT what the "סטטוס חשבון" badge
  // displays or what gates the cancel-item action — see paymentStatus below
  // for why those two are deliberately different things.
  sessionStatus: 'open' | 'closed';
  // The account's real settlement status — computed bottom-up from its own
  // participants ('paid' only once EVERY participant's own paymentStatus is
  // 'paid'; 'open' otherwise, including when there are no participants at
  // all) — 2026-10-22, per explicit correction: the previous version let
  // sessionStatus (a raw DB flag close-session can set to 'closed' with
  // zero real payment confirmation — see close-session's own gate, which
  // only blocks on an explicit 'pending' share and has nothing to block on
  // when no share rows exist at all) flow DOWN into each participant as a
  // fallback. That's backwards: the parent's status must be an aggregate of
  // its children, never the other way around — two diners at one table, one
  // paid and one still mid-meal, must never show the whole account as
  // "שולם" just because the session row happens to be flagged closed. This
  // is the field the "סטטוס חשבון" badge renders, and what AccountDetailPanel
  // uses to gate the cancel-item action (not sessionStatus) — "paid" is the
  // real reason a credit has to go through the clearing system instead.
  paymentStatus: 'open' | 'paid';
  openedAt: string;
  closedAt: string | null;
  participants: AccountParticipant[];
  // Live total — sum of non-cancelled items only (no real payment exists
  // yet, so this is always computed from order_items, never from
  // payment_events — see 12.Feedbook_Accounts_Module_Spec v3 §2/§4).
  totalCost: number;
  cancelledCount: number;
  // Sum of payment_participant_shares.tip_amount for this session (PRD
  // §5.1.5 lists "סך טיפ כולל" alongside the account total) — 0 today for
  // the same reason as paymentMethod above.
  totalTip: number;
  // Credit/cash split of totalCost (2026-10-25, per explicit request) —
  // computed bottom-up same as paymentStatus: sum of each participant's own
  // totalCost, grouped by THEIR OWN paymentMethod (a per-diner fact, not a
  // session-wide one — see AccountParticipant.paymentMethod's own comment).
  // A participant with no payment method yet (null) contributes to neither.
  // Always 0/0 today for the same reason as totalTip.
  totalCredit: number;
  totalCash: number;
}

interface RawRow {
  id: string;
  status: AccountOrderItem['status'];
  quantity: number;
  unit_price: number;
  cancellation_reason: string | null;
  dishes: { name: string } | null;
  dish_size_options: { name: string } | null;
  order_item_modifiers:
    | { price_delta_at_order: number; dish_modifier_options: { name: string } | null; modifier_option_serving_variants: { name: string } | null }[]
    | null;
  orders: {
    id: string;
    bar_ticket_number: number | null;
    session_participants: { id: string; sub_account_number: string } | null;
    table_sessions: {
      id: string;
      status: 'open' | 'closed';
      session_account_number: string;
      opened_at: string;
      closed_at: string | null;
      tables: { table_number: string; table_type: string | null } | null;
    } | null;
  } | null;
}

// Mirrors useOrderHistory.ts's shape (fetch + refresh, no internal
// Realtime subscription — the consuming screen owns that channel, same
// split as every other screen's own hook in this app) — but grouped into
// session/table rows instead of a flat item list, per PRD §5.1.5 / App
// Flow §3.10 ("חשבונות" module).
export function useAccounts(restaurantId: string | undefined) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const [{ data }, { data: pendingRequests }, { data: paymentRows }] = await Promise.all([
      supabase
        .from('order_items')
        .select(
          'id, status, quantity, unit_price, cancellation_reason, dishes(name), dish_size_options(name), order_item_modifiers(price_delta_at_order, dish_modifier_options(name), modifier_option_serving_variants(name)), orders!inner(id, bar_ticket_number, session_participants(id, sub_account_number), table_sessions!inner(id, restaurant_id, status, session_account_number, opened_at, closed_at, tables(table_number, table_type)))',
        )
        .eq('orders.table_sessions.restaurant_id', restaurantId)
        .returns<RawRow[]>(),
      supabase
        .from('order_item_cancellation_requests')
        .select('id, order_item_id, order_items!inner(orders!inner(table_sessions!inner(restaurant_id)))')
        .eq('status', 'pending')
        .eq('order_items.orders.table_sessions.restaurant_id', restaurantId)
        .returns<{ id: string; order_item_id: string }[]>(),
      // Always empty today (see totalTip/paymentMethod/paymentStatus's own
      // comments on AccountRow/AccountParticipant) — fetched anyway so the
      // columns work for free once Stage 6's real payment flow starts
      // writing these rows.
      supabase
        .from('payments')
        .select('session_id, payment_method, payment_participant_shares(participant_id, tip_amount, status), table_sessions!inner(restaurant_id)')
        .eq('table_sessions.restaurant_id', restaurantId)
        .returns<
          {
            session_id: string;
            payment_method: string | null;
            payment_participant_shares: { participant_id: string; tip_amount: number; status: 'pending' | 'paid' }[];
          }[]
        >(),
    ]);

    const pendingByItemId = new Map((pendingRequests ?? []).map((r) => [r.order_item_id, r.id]));
    const totalTipBySessionId = new Map<string, number>();
    const tipByParticipantId = new Map<string, number>();
    const paymentMethodByParticipantId = new Map<string, 'credit_card' | 'cash' | null>();
    const paymentStatusByParticipantId = new Map<string, 'open' | 'paid'>();
    for (const p of paymentRows ?? []) {
      for (const share of p.payment_participant_shares ?? []) {
        totalTipBySessionId.set(p.session_id, (totalTipBySessionId.get(p.session_id) ?? 0) + Number(share.tip_amount));
        tipByParticipantId.set(share.participant_id, (tipByParticipantId.get(share.participant_id) ?? 0) + Number(share.tip_amount));
        paymentMethodByParticipantId.set(share.participant_id, p.payment_method as 'credit_card' | 'cash' | null);
        paymentStatusByParticipantId.set(share.participant_id, share.status === 'paid' ? 'paid' : 'open');
      }
    }

    // Diner display names for bar pickup tickets aren't needed here (the
    // row shows the ticket number itself, same as useOrders.ts's kitchen
    // queue) — unlike that screen, this one has no per-diner name to batch.
    const bySession = new Map<string, AccountRow>();
    for (const row of data ?? []) {
      const order = row.orders;
      const session = order?.table_sessions;
      if (!order || !session) continue;
      const isBar = order.bar_ticket_number !== null;

      let sessionRow = bySession.get(session.id);
      if (!sessionRow) {
        sessionRow = {
          sessionId: session.id,
          isBar,
          tableNumber: session.tables?.table_number ?? '—',
          sessionAccountNumber: session.session_account_number,
          sessionStatus: session.status,
          // Recomputed below from the final participants list once every
          // row has been processed — these starting values are never read.
          paymentStatus: 'open',
          totalCredit: 0,
          totalCash: 0,
          openedAt: session.opened_at,
          closedAt: session.closed_at,
          participants: [],
          totalCost: 0,
          cancelledCount: 0,
          totalTip: totalTipBySessionId.get(session.id) ?? 0,
        };
        bySession.set(session.id, sessionRow);
      }

      // Table: one participant row per diner (sub_account_number). Bar: one
      // participant "row" per order's own ticket number — a bar order has
      // no session_participants link worth grouping by (see scan-qr's own
      // comment on why the bar never tracks per-diner identity).
      const participantKey = isBar ? `bar-${order.id}` : (order.session_participants?.id ?? order.id);
      const displayNumber = isBar ? String(order.bar_ticket_number).padStart(4, '0') : (order.session_participants?.sub_account_number ?? '—');
      let participant = sessionRow.participants.find((p) => p.participantId === participantKey);
      if (!participant) {
        // Bar pseudo-participants are keyed by order.id, not a real
        // session_participants.id, so they never resolve a real payment
        // share — consistent with the bar not tracking per-diner identity.
        const realParticipantId = order.session_participants?.id;
        const tipAmount = isBar || !realParticipantId ? 0 : (tipByParticipantId.get(realParticipantId) ?? 0);
        const paymentMethod = isBar || !realParticipantId ? null : (paymentMethodByParticipantId.get(realParticipantId) ?? null);
        // No inheritance from the session (2026-10-22, per explicit
        // correction — the causality runs the other way: see
        // AccountRow.paymentStatus below). A participant's own status comes
        // only from their own real payment_participant_shares row; with no
        // such row yet, they're honestly 'open' — never assumed paid just
        // because something else says the account is.
        const paymentStatus: 'open' | 'paid' = isBar || !realParticipantId ? 'open' : (paymentStatusByParticipantId.get(realParticipantId) ?? 'open');
        participant = { participantId: participantKey, displayNumber, items: [], totalCost: 0, tipAmount, paymentMethod, paymentStatus };
        sessionRow.participants.push(participant);
      }

      const modifiers = (row.order_item_modifiers ?? []).map((m) => ({
        name: m.dish_modifier_options?.name ?? '',
        priceDelta: Number(m.price_delta_at_order),
        servingVariantName: m.modifier_option_serving_variants?.name ?? null,
      }));
      const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
      participant.items.push({
        id: row.id,
        dishName: row.dishes?.name ?? '',
        sizeOptionName: row.dish_size_options?.name ?? null,
        quantity: row.quantity,
        unitPrice: Number(row.unit_price),
        modifierTotal,
        modifiers,
        status: row.status,
        cancellationReason: row.cancellation_reason,
        pendingCancellationRequestId: pendingByItemId.get(row.id) ?? null,
      });

      if (row.status === 'cancelled') {
        sessionRow.cancelledCount += 1;
      } else {
        const itemTotal = (Number(row.unit_price) + modifierTotal) * row.quantity;
        sessionRow.totalCost += itemTotal;
        participant.totalCost += itemTotal;
      }
    }

    // Bottom-up, after every row has been processed and every participant's
    // own paymentStatus is final — see AccountRow.paymentStatus's own
    // comment for why this can't just mirror sessionStatus.
    for (const sessionRow of bySession.values()) {
      sessionRow.paymentStatus =
        sessionRow.participants.length > 0 && sessionRow.participants.every((p) => p.paymentStatus === 'paid') ? 'paid' : 'open';
      for (const participant of sessionRow.participants) {
        if (participant.paymentMethod === 'credit_card') sessionRow.totalCredit += participant.totalCost;
        else if (participant.paymentMethod === 'cash') sessionRow.totalCash += participant.totalCost;
      }
    }

    setRows(
      [...bySession.values()].sort((a, b) => {
        if (a.paymentStatus !== b.paymentStatus) return a.paymentStatus === 'open' ? -1 : 1;
        return a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true });
      }),
    );
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    // Initial fetch on mount/restaurantId change — refresh() sets rows/
    // loading(false) only after its own await resolves, not synchronously
    // in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Self-contained, unlike useOrders.ts's own convention (that hook leaves
  // the channel to Dashboard.tsx, which stays mounted for every tab) —
  // AccountsScreen is only mounted while its own tab is active, so owning
  // the subscription here means it's created/torn down with the screen
  // itself, no wiring needed in Dashboard.tsx.
  useEffect(() => {
    if (!restaurantId) return;
    const channel = supabase
      .channel(`accounts-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_cancellation_requests' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, () => void refresh())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [restaurantId, refresh]);

  // Role-gated server-side (request-order-item-cancellation: manager acts
  // immediately, waiter only opens a pending request, kitchen gets 403) —
  // see that function's own comment for why this never writes to
  // payment_events (not a refund — the account hasn't been charged yet).
  async function requestCancellation(orderItemId: string, reason: string) {
    const { data, error } = await supabase.functions.invoke<{ error?: { code: string; message: string } }>('request-order-item-cancellation', {
      body: { order_item_id: orderItemId, reason },
    });
    if (error || data?.error) {
      throw new Error(data?.error?.message ?? 'Failed to request the cancellation');
    }
    void refresh();
  }

  // Manager-only (decide-order-item-cancellation-request itself enforces
  // this server-side too).
  async function decideCancellation(requestId: string, decision: 'approve' | 'reject') {
    const { data, error } = await supabase.functions.invoke<{ error?: { code: string; message: string } }>('decide-order-item-cancellation-request', {
      body: { request_id: requestId, decision },
    });
    if (error || data?.error) {
      throw new Error(data?.error?.message ?? 'Failed to decide the request');
    }
    void refresh();
  }

  return { loading, rows, refresh, requestCancellation, decideCancellation };
}

export interface PaymentEvent {
  id: string;
  eventType: 'charge' | 'refund' | 'tip_added' | 'tip_adjusted' | 'cancellation_refund';
  amount: number;
  reason: string | null;
  createdAt: string;
}

// Lazy, per-row fetch for the "יומן אירועים" tab (opened only when a row is
// expanded, per 12.Feedbook_Accounts_Module_Spec v3 §3) — always empty
// today, since nothing writes to payment_events yet (no real payment flow,
// and the cancellation action deliberately doesn't — see §4). Wired up now
// so the tab works for free once Stage 6 payment lands.
export async function fetchPaymentEvents(sessionId: string): Promise<PaymentEvent[]> {
  const { data } = await supabase
    .from('payment_events')
    .select('id, event_type, amount, reason, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type as PaymentEvent['eventType'],
    amount: Number(row.amount),
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
