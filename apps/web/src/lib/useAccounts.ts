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
  // a future "קופת טיפים" (shared tip pool) aggregate and analytics. Real
  // since confirm-card-payment/confirm-cash-payment started writing these
  // rows (2026-11-08/09) — resolved via order.session_participants.id,
  // which is now real and stable for a bar diner too (bar_ticket_number
  // lives on session_participants as of 2026-10-15, assigned once at
  // join-session and reused by every order), not bar-excluded anymore.
  tipAmount: number;
  // How THIS diner settled their own share (payments.payment_method,
  // resolved through their own payment_participant_shares row) — moved
  // here from AccountRow 2026-10-22, per explicit request: payment method
  // is naturally a per-diner fact (each participant can settle separately,
  // by_item or even), not a session-wide one. Real for the bar too — see
  // tipAmount's own comment above.
  paymentMethod: 'credit_card' | 'cash' | null;
  // This diner's own share status (payment_participant_shares.status) —
  // 2026-10-22, per explicit request to show "פתוח"/"שולם" per personal
  // account, not just at the session level. 'open' when there's no share
  // row yet (nothing paid) or it's still 'pending'; 'paid' once their share
  // is settled. Real for the bar too — see tipAmount's own comment above.
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
  //
  // For a table (non-bar), this is a real bottom-up aggregate even once
  // sessionStatus is 'closed' — NOT a blind "closed ⇒ paid" stamp (that was
  // the 2026-11-03 version of this field; found wrong and fixed 2026-11-08,
  // the same shape of bug as the bar's own 2026-11-04 fix above). The
  // assumption behind the old stamp — that close-session only ever closes a
  // session with real proof every share is paid, or no share data at all —
  // turns out false today: close-session's own unpaid-shares check only
  // ever queries real payment_participant_shares rows, and nothing writes
  // those yet (Stage 6), so it NEVER blocks a close in practice, no matter
  // what a participant's own (locally-tracked) paymentStatus says. A closed
  // table session with a real, still-unpaid participant is a genuine,
  // observed case (not hypothetical) — it shows 'closed' here (renders
  // "טרם שולם", same as the bar's pending state), not 'paid'.
  //
  // The bar is a DIFFERENT model entirely (2026-11-04, explicit user
  // correction, four rounds): there is exactly ONE general shared account
  // per trading day (the one `table_sessions` row scan-qr reuses for every
  // bar diner — see that function's own comment), governed purely by the
  // bar's (or, unconfigured, the restaurant's) operating HOURS, not by
  // individual pickup tickets:
  //   1. 'open' — within hours (sessionStatus 'open'). This is the single
  //      "today's active account" AccountsScreen.tsx renders in its own
  //      primary block at the top of the open tab, regardless of what
  //      bar_close_if_inactive's schedule check will eventually do.
  //   2. 'closed' — hours ended (sessionStatus flips to 'closed' purely on
  //      the clock, via bar_close_if_inactive) with a REAL balance
  //      (totalCost > 0) still outstanding and not every pickup ticket
  //      individually paid. NOT history-eligible (see isAccountSettled
  //      below) — AccountsScreen.tsx renders these in a second "pending,
  //      for the restaurant to review" block, still under the open tab, not
  //      the primary one (there's never more than one 'open' row, but there
  //      can be any number of these).
  //   3. 'paid' — either every real pickup ticket is individually paid
  //      (bottom-up, same shape as the table model below — unreachable
  //      today with a real balance, since bar pseudo-participants have no
  //      real per-diner payment tracking yet, see
  //      AccountParticipant.paymentStatus's own comment: always 'open'; this
  //      starts resolving naturally once Stage 6 lands real per-ticket
  //      payment), OR totalCost is exactly 0 (nothing was ever ordered —
  //      vacuously nothing left to collect, so it's "paid" even though no
  //      real payment ever happened). Either way, history-eligible —
  //      "only status 'שולם' moves to history" is the whole rule.
  paymentStatus: 'open' | 'paid' | 'closed';
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

// Single source of truth for "is this account really done" (2026-11-04,
// explicit user request, simplified the same day once the bar's third state
// settled into its final shape) — AccountsScreen.tsx's open/history tab
// split and AccountDetailPanel's cancel-item gate both defer to this instead
// of each re-deriving it from paymentStatus separately. Exactly 'paid': for
// a table that's the existing bottom-up/Stage-6-placeholder meaning; for the
// bar it's "nothing left to collect" (either genuinely all paid, or nothing
// was ever owed) — see AccountRow.paymentStatus's own comment. A bar
// account that's merely 'closed' (hours ended, real balance still
// outstanding) is explicitly NOT settled — it stays visible for the
// restaurant to act on, not history.
export function isAccountSettled(row: AccountRow): boolean {
  return row.paymentStatus === 'paid';
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
    // EOD sweep for ordinary tables (2026-11-21, real feature — see
    // close_zero_balance_table_sessions' own migration comment) — same
    // "piggyback on whichever staff screen happens to be open" pattern as
    // bar_close_if_inactive just below, not a real cron (none exists in
    // this project). Awaited on its own, before the main fetch, so a
    // session it just closed is immediately reflected as 'paid'/history-
    // eligible in THIS refresh, not one cycle later. A no-op whenever
    // restaurant_is_active() is still true, so this never fires mid-service.
    if (restaurantId) {
      await supabase.rpc('close_zero_balance_table_sessions', { p_restaurant_id: restaurantId });
    }

    const [{ data }, { data: pendingRequests }, { data: paymentRows }, { data: zeroOrderBarSessions }, { data: allTableParticipants }] = await Promise.all([
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
      // Real bug found 2026-11-05: the order_items-driven query above can
      // never produce a row for a session with zero orders — exactly what
      // today's freshly (proactively) opened bar account looks like before
      // its first order. Fetched separately and merged in below so the
      // bar's own general account shows up — at ₪0 — the moment it exists.
      //
      // NOT scoped to status='open' (2026-11-05, second real bug found the
      // same day): a zero-order account that then CLOSES (bar hours ended
      // with nobody ordering — a completely ordinary day) fell into a gap
      // between the two queries — no orders to be found by the one above,
      // no longer 'open' for an earlier version of this one — and simply
      // vanished from both the open tab and history entirely. Every bar
      // session with zero orders, open or closed, is fetched here; the
      // existing client-side date filter in AccountsScreen.tsx (same one
      // that already bounds the order_items-driven rows — this query is no
      // less bounded than that one) keeps history from accumulating
      // unboundedly, same as it's always worked for every other row. Still
      // scoped to the bar specifically, not every zero-order table scan
      // ever — that's out of scope here, same as it's always been.
      //
      // bar_close_if_inactive is also called here (2026-11-05, real gap
      // found live) — there's no cron, and until now nothing on this
      // screen ever triggered the proactive-open/schedule-close check
      // (only BarOrdersScreen/TableStatusBoard's own polling, or a diner's
      // scan, did), so simply opening the Accounts screen before any of
      // those had happened could show nothing at all even well past the
      // bar's own opening hour.
      supabase.rpc('bar_close_if_inactive', { p_restaurant_id: restaurantId }).then(() =>
        supabase
          .from('table_sessions')
          .select('id, session_account_number, status, opened_at, closed_at, tables!inner(table_number, table_type)')
          .eq('restaurant_id', restaurantId)
          .eq('tables.table_type', 'bar')
          .returns<
            { id: string; session_account_number: string; status: 'open' | 'closed'; opened_at: string; closed_at: string | null; tables: { table_number: string } | null }[]
          >(),
      ),
      // Real gap found 2026-11-08, same user request that surfaced the
      // closed-table-paid-status bug above: a diner who scans in and joins
      // a table (a real session_participants row) but never places an
      // order has no order_items at all — the main query above is driven
      // entirely by order_items, so such a diner never produces a
      // participant entry and simply never appears in the account's own
      // breakdown, even though the restaurant may want it on record that
      // they were there. Fetched separately (every table-type
      // session_participant for this restaurant, not scoped to any one
      // session) and merged in below, once per session that the main query
      // already produced a row for. Table-only, like zeroOrderBarSessions
      // above — the bar deliberately has no per-diner identity to merge in
      // (AccountRow.isBar's own participants are keyed by pickup ticket,
      // not session_participants; see scan-qr's own comment on why).
      supabase
        .from('session_participants')
        .select('id, session_id, sub_account_number, left_at, table_sessions!inner(restaurant_id)')
        .eq('table_sessions.restaurant_id', restaurantId)
        .returns<{ id: string; session_id: string; sub_account_number: string; left_at: string | null }[]>(),
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
    // Real bug found live (2026-11-21, general account #635287): a diner
    // added to someone else's personal account in 'full' split mode, with
    // ZERO order value of their own, genuinely IS settled the moment
    // confirm-card-payment runs — it writes them a real
    // payment_participant_shares row (status 'paid', amount_paid 0) AND
    // sets their own left_at, same as every other member of that payment.
    // But neither signal was ever consulted below for a participant who has
    // no order_items at all (the allTableParticipants merge-in path, just
    // below, used to hardcode 'open'/0/null unconditionally) — so this
    // diner's own badge stayed "טרם שולם" forever, even though their phone
    // had already shown "שולם ונסגר" and kicked them back to their profile.
    // left_at is the more authoritative of the two (set by every real
    // settlement path, including the new close_zero_balance_table_sessions
    // EOD sweep, which writes no payment_participant_shares row at all) —
    // checked as an OR alongside the real share status, never instead of it.
    const leftAtByParticipantId = new Set((allTableParticipants ?? []).filter((sp) => sp.left_at !== null).map((sp) => sp.id));
    function resolvedPaymentStatus(participantId: string | null | undefined): 'open' | 'paid' {
      if (!participantId) return 'open';
      return paymentStatusByParticipantId.get(participantId) === 'paid' || leftAtByParticipantId.has(participantId) ? 'paid' : 'open';
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
        // The row itself is still keyed per order for the bar (participantKey
        // above) — unchanged. But the real payment lookup below is NOT
        // bar-excluded anymore (real bug found live 2026-11-09, same shape
        // as the closed-session-≠-paid fix: a bar diner paid for real via
        // confirm-card-payment/confirm-cash-payment — a genuine
        // payment_participant_shares row exists, keyed to their real
        // session_participants.id — yet this row stayed hardcoded 'open'/0/
        // null forever). The "bar has no stable per-diner identity" reasoning
        // this used to rely on stopped being true on 2026-10-15
        // (bar_ticket_as_personal_account): a bar diner's ticket number is
        // assigned once at join-session and reused by every order they
        // place, so order.session_participants?.id is exactly as real and
        // stable for the bar as it already is for a table.
        const realParticipantId = order.session_participants?.id;
        const tipAmount = !realParticipantId ? 0 : (tipByParticipantId.get(realParticipantId) ?? 0);
        const paymentMethod = !realParticipantId ? null : (paymentMethodByParticipantId.get(realParticipantId) ?? null);
        const paymentStatus = resolvedPaymentStatus(realParticipantId);
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

    // Merge in any bar session (open OR closed) the loop above never
    // touched because it has zero orders — see zeroOrderBarSessions's own
    // fetch comment above for why this isn't scoped to open-only. Empty on
    // purpose: no participants, ₪0 — exactly what "general account for a
    // day nobody ordered from" honestly looks like, whether it's today's
    // still-open account or a past, fully-uneventful day in history.
    for (const session of zeroOrderBarSessions ?? []) {
      if (bySession.has(session.id)) continue;
      bySession.set(session.id, {
        sessionId: session.id,
        isBar: true,
        tableNumber: session.tables?.table_number ?? '—',
        sessionAccountNumber: session.session_account_number,
        sessionStatus: session.status,
        // Recomputed below from the final participants list, same as every
        // other sessionRow — this starting value is never read.
        paymentStatus: 'open',
        openedAt: session.opened_at,
        closedAt: session.closed_at,
        participants: [],
        totalCost: 0,
        cancelledCount: 0,
        totalTip: 0,
        totalCredit: 0,
        totalCash: 0,
      });
    }

    // Merge in a diner who joined a table (a real session_participants row)
    // but never placed an order — real gap found 2026-11-08, same report
    // that surfaced the closed-table-paid-status bug above. Only added to a
    // session the main query already produced a row for (never creates a
    // session on its own, unlike zeroOrderBarSessions above — a table
    // session with ZERO orders from anyone is still out of scope here, same
    // as it's always been) and only when that participant doesn't already
    // have a real entry from an actual order. ₪0 here, but NOT a blind
    // 'open' (real bug found live 2026-11-21, general account #635287 —
    // see resolvedPaymentStatus's own comment above): this diner may well
    // already be genuinely settled (a real payment_participant_shares row,
    // or left_at) despite having zero order_items of their own — a zero-
    // order diner added to someone else's account in 'full' split mode is
    // exactly that case, and this is the ONLY path that ever builds their
    // participant entry at all, so it must resolve the real status itself,
    // not assume a later normalization pass will fix it up (that pass only
    // ever runs once the whole SESSION is no longer 'open', which a diner
    // who left early from an otherwise still-active table never waits for).
    for (const sp of allTableParticipants ?? []) {
      const sessionRow = bySession.get(sp.session_id);
      if (!sessionRow || sessionRow.isBar) continue;
      if (sessionRow.participants.some((p) => p.participantId === sp.id)) continue;
      sessionRow.participants.push({
        participantId: sp.id,
        displayNumber: sp.sub_account_number,
        items: [],
        totalCost: 0,
        tipAmount: tipByParticipantId.get(sp.id) ?? 0,
        paymentMethod: paymentMethodByParticipantId.get(sp.id) ?? null,
        paymentStatus: resolvedPaymentStatus(sp.id),
      });
    }

    // Bottom-up, after every row has been processed and every participant's
    // own paymentStatus/totalCost is final — see AccountRow.paymentStatus's
    // own comment for why tables and the bar use two genuinely different
    // computations here, not one shared rule.
    for (const sessionRow of bySession.values()) {
      // Real bug found 2026-11-05: a participant whose every item got
      // cancelled has totalCost 0 but kept a hardcoded 'open'
      // paymentStatus forever (bar pseudo-participants always start 'open'
      // — see where they're built above; a table participant with no real
      // payment_participant_shares row falls back to 'open' the same way)
      // — showing "טרם שולם" on a ticket/sub-account with literally nothing
      // left to collect. Fixed here, before either paymentStatus
      // computation below reads it, so the table's own bottom-up aggregate
      // benefits the same way a bar account's vacuous zero-balance case
      // already did at the session level (see the isBar branch just below).
      //
      // Gated on the session no longer being 'open' (2026-11-21, real bug
      // found live — user report: a diner still physically seated, who
      // simply hadn't ordered anything yet, showed "שולם" on this screen).
      // An unconditional version of this normalization fed straight into
      // everyParticipantPaid below and made a still-active, nobody's-
      // ordered-yet table read as fully "שולם" the moment it was opened —
      // contradicting the 'open' branch's own stated intent a few lines
      // down ("a freshly-opened empty table must stay 'open'/'פעיל'").
      // Zero balance only means "nothing left to collect" once the account
      // itself is actually done (closed by a real payment, or by the new
      // close_zero_balance_table_sessions EOD sweep below) — not merely
      // "nothing owed at this exact moment" while the visit is still live.
      if (sessionRow.sessionStatus !== 'open') {
        for (const participant of sessionRow.participants) {
          if (participant.totalCost === 0) participant.paymentStatus = 'paid';
        }
      }

      if (sessionRow.isBar) {
        // Vacuously true with zero participants, and now also true whenever
        // every participant's own totalCost is 0 (fixed above) — kept as its
        // own explicit totalCost === 0 check on the session too, since a mix
        // of one zero-balance participant and one real unpaid one must still
        // resolve to "closed", not "paid".
        const everyTicketPaid = sessionRow.participants.every((p) => p.paymentStatus === 'paid');
        sessionRow.paymentStatus =
          sessionRow.sessionStatus === 'open' ? 'open' : sessionRow.totalCost === 0 || everyTicketPaid ? 'paid' : 'closed';
      } else {
        const everyParticipantPaid = sessionRow.participants.length > 0 && sessionRow.participants.every((p) => p.paymentStatus === 'paid');
        sessionRow.paymentStatus =
          sessionRow.sessionStatus === 'open'
            ? everyParticipantPaid
              ? 'paid'
              : 'open'
            : // Closed: real bottom-up check, not a blind 'paid' stamp (real
              // bug found 2026-11-08 — close-session has no real payment
              // integration yet, so it never actually blocks on a genuinely
              // pending share: a closed table session can and does still
              // have participants whose own paymentStatus is 'open'. Mirrors
              // the bar's own fix for the identical shape of bug).
              // totalCost === 0 covers a closed table nobody ever ordered
              // from (same vacuous case as the bar) — not needed on the
              // 'open' branch above, where a freshly-opened empty table must
              // stay 'open'/"פעיל", not read as already "done".
              sessionRow.totalCost === 0 || everyParticipantPaid
              ? 'paid'
              : 'closed';
      }
      for (const participant of sessionRow.participants) {
        if (participant.paymentMethod === 'credit_card') sessionRow.totalCredit += participant.totalCost;
        else if (participant.paymentMethod === 'cash') sessionRow.totalCash += participant.totalCost;
      }
    }

    setRows(
      [...bySession.values()].sort((a, b) => {
        // 'open' always first; 'paid' vs 'closed' are both just "not open"
        // and have no defined relative order here — historyRows below
        // re-sorts by closedAt anyway, so this only needs to be a consistent
        // (non-contradictory) ordering, not a meaningful one.
        const rank = (s: AccountRow['paymentStatus']) => (s === 'open' ? 0 : 1);
        if (rank(a.paymentStatus) !== rank(b.paymentStatus)) return rank(a.paymentStatus) - rank(b.paymentStatus);
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

  // Periodic re-check (2026-11-05, real gap found live) — same reasoning as
  // useBarStatus.ts's own interval: the wall clock alone crossing the bar's
  // opening hour writes nothing to the DB by itself (nothing to subscribe
  // to above), so a screen left open straight through that moment would
  // otherwise never call refresh() again and never notice today's account
  // was supposed to appear. 15s, same interval as useBarStatus.ts, for the
  // same reason (far from "real time" at 60s, needless load below it).
  useEffect(() => {
    if (!restaurantId) return;
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
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
