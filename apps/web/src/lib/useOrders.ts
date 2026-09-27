import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export type KitchenItemStatus = 'in_progress' | 'ready' | 'served' | 'cancelled';

export interface KitchenOrderItem {
  id: string;
  orderId: string;
  status: KitchenItemStatus;
  statusUpdatedAt: string;
  placedAt: string;
  quantity: number;
  dishName: string;
  sizeName: string | null;
  modifierSummary: string;
  tableNumber: string;
  // null until the kitchen records an inventory decision for a cancelled
  // item (record_cancellation_inventory_decision) — cancellation itself is
  // instant and never waits on this; it's a separate, deferred bookkeeping
  // question the kitchen answers afterward.
  cancellationRestocked: boolean | null;
  // Set only for orders placed at the shared bar (table_type='bar') — the
  // short-lived, staff-facing pickup ticket assigned by
  // place_order_transaction, never the diner's own persistent account
  // number. barDisplayName is filled in by a separate batched RPC call
  // below (bar_participant_display_names) rather than this main query, so
  // a plain SELECT here never has to touch user_profiles.
  barTicketNumber: number | null;
  barDisplayName: string | null;
  // Table orders (unlike bar orders, which already have their own distinct
  // ticket-based identity above) had no way to tell which specific diner at
  // a shared table an order came from — requested 2026-09-19, after the
  // notification feature raised the same gap: "שולחן 5" alone doesn't say
  // which of that table's diners placed/cancelled it. Null for bar orders
  // (session_account_number/sub_account_number exist there too, but the
  // ticket already serves the same purpose more usefully).
  sessionAccountNumber: string | null;
  subAccountNumber: string | null;
  // Optional per-dish expected cooking time, set in the menu editor — null
  // means the dish never had one configured, and the kitchen screen must
  // never guess a default; the traffic-light indicator stays neutral then.
  prepTimeMinutes: number | null;
}

interface RawRow {
  id: string;
  order_id: string;
  status: KitchenItemStatus;
  status_updated_at: string;
  quantity: number;
  cancellation_restocked: boolean | null;
  dishes: { name: string; prep_time_minutes: number | null } | null;
  dish_size_options: { name: string } | null;
  order_item_modifiers: { dish_modifier_options: { name: string } | null }[] | null;
  orders: {
    placed_at: string;
    bar_ticket_number: number | null;
    session_participants: { sub_account_number: string } | null;
    table_sessions: { session_account_number: string; tables: { table_number: string; table_type: string | null } | null } | null;
  } | null;
}

// Mirrors useInventory.ts's shape exactly — fetch + refresh callback, no
// internal Realtime subscription (the consuming screen owns that, same
// split as Dashboard.tsx's own ingredients channel).
export function useOrders(restaurantId: string | undefined) {
  const [items, setItems] = useState<KitchenOrderItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('order_items')
      .select(
        'id, order_id, status, status_updated_at, quantity, cancellation_restocked, dishes(name, prep_time_minutes), dish_size_options(name), order_item_modifiers(dish_modifier_options(name)), orders!inner(placed_at, bar_ticket_number, session_participants(sub_account_number), table_sessions!inner(restaurant_id, session_account_number, tables(table_number, table_type)))',
      )
      .eq('orders.table_sessions.restaurant_id', restaurantId)
      // A cancelled item is included here too, but only while it still
      // needs an inventory decision (cancellation_restocked is null) — once
      // the kitchen records restock/no-restock it's done-and-filed and only
      // shows up in the history tab, same as a served item.
      .or('status.in.(in_progress,ready),and(status.eq.cancelled,cancellation_restocked.is.null)')
      .returns<RawRow[]>();

    const mapped: KitchenOrderItem[] = (data ?? [])
      .filter((row) => row.orders)
      .map((row) => ({
        id: row.id,
        orderId: row.order_id,
        status: row.status,
        statusUpdatedAt: row.status_updated_at,
        placedAt: row.orders!.placed_at,
        quantity: row.quantity,
        dishName: row.dishes?.name ?? '',
        sizeName: row.dish_size_options?.name ?? null,
        modifierSummary: (row.order_item_modifiers ?? [])
          .map((m) => m.dish_modifier_options?.name)
          .filter((n): n is string => !!n)
          .join(', '),
        tableNumber: row.orders!.table_sessions?.tables?.table_number ?? '—',
        barTicketNumber: row.orders!.bar_ticket_number,
        barDisplayName: null,
        cancellationRestocked: row.cancellation_restocked,
        sessionAccountNumber: row.orders!.bar_ticket_number === null ? (row.orders!.table_sessions?.session_account_number ?? null) : null,
        subAccountNumber: row.orders!.bar_ticket_number === null ? (row.orders!.session_participants?.sub_account_number ?? null) : null,
        prepTimeMinutes: row.dishes?.prep_time_minutes ?? null,
      }))
      .sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime());

    // Diner display names live in user_profiles, which plain staff RLS
    // doesn't grant read access to (by design — see bar_participant_
    // display_names' own migration comment). One batched RPC call for
    // every bar order currently in the queue, instead of an N+1 per row.
    const barOrderIds = [...new Set(mapped.filter((item) => item.barTicketNumber !== null).map((item) => item.orderId))];
    if (barOrderIds.length > 0) {
      const { data: names } = await supabase.rpc('bar_participant_display_names', { p_order_ids: barOrderIds });
      const nameByOrderId = new Map((names ?? []).map((row: { order_id: string; display_name: string | null }) => [row.order_id, row.display_name]));
      for (const item of mapped) {
        if (item.barTicketNumber !== null) {
          item.barDisplayName = nameByOrderId.get(item.orderId) ?? null;
        }
      }
    }

    setItems(mapped);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { loading, items, refresh };
}
