import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { KitchenItemStatus } from './useOrders';

export interface OrderHistoryItem {
  id: string;
  orderId: string;
  status: KitchenItemStatus;
  statusUpdatedAt: string;
  placedAt: string;
  quantity: number;
  unitPrice: number;
  dishName: string;
  sizeName: string | null;
  modifierSummary: string;
  tableNumber: string;
  barTicketNumber: number | null;
  // null until the kitchen records an inventory decision for a cancelled
  // item (see record_cancellation_inventory_decision) — the answer to
  // "did we lose this ingredient, or was it never touched?". Cancellation
  // itself is instant and never waits on this decision.
  cancellationRestocked: boolean | null;
  // The reason the diner picked (or typed under "אחר") in the mobile app's
  // cancellation-reason modal (2026-09-19) — null for cancellations that
  // predate that feature, same honesty convention as cancellationRestocked.
  cancellationReason: string | null;
  // Same gap, same fix as useOrders.ts's KitchenOrderItem — see its comment.
  sessionAccountNumber: string | null;
  subAccountNumber: string | null;
}

interface RawRow {
  id: string;
  order_id: string;
  status: KitchenItemStatus;
  status_updated_at: string;
  quantity: number;
  unit_price: number;
  cancellation_restocked: boolean | null;
  cancellation_reason: string | null;
  dishes: { name: string } | null;
  dish_size_options: { name: string } | null;
  order_item_modifiers: { dish_modifier_options: { name: string } | null }[] | null;
  orders: {
    placed_at: string;
    bar_ticket_number: number | null;
    session_participants: { sub_account_number: string } | null;
    table_sessions: { session_account_number: string; tables: { table_number: string } | null } | null;
  } | null;
}

// Unlike useOrders.ts (the live kitchen queue — only active statuses),
// this fetches every order_item ever placed for the restaurant, regardless
// of status — the "היסטוריה" tab the user asked for right after seeing a
// cancelled item simply vanish from the active queue with no way to look
// it back up. Fetched only while that tab is open (see KitchenScreen.tsx),
// not on every dashboard load.
export function useOrderHistory(restaurantId: string | undefined) {
  const [items, setItems] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('order_items')
      .select(
        'id, order_id, status, status_updated_at, quantity, unit_price, cancellation_restocked, cancellation_reason, dishes(name), dish_size_options(name), order_item_modifiers(dish_modifier_options(name)), orders!inner(placed_at, bar_ticket_number, session_participants(sub_account_number), table_sessions!inner(restaurant_id, session_account_number, tables(table_number)))',
      )
      .eq('orders.table_sessions.restaurant_id', restaurantId)
      .returns<RawRow[]>();

    const mapped: OrderHistoryItem[] = (data ?? [])
      .filter((row) => row.orders)
      .map((row) => ({
        id: row.id,
        orderId: row.order_id,
        status: row.status,
        statusUpdatedAt: row.status_updated_at,
        placedAt: row.orders!.placed_at,
        quantity: row.quantity,
        unitPrice: row.unit_price,
        dishName: row.dishes?.name ?? '',
        sizeName: row.dish_size_options?.name ?? null,
        modifierSummary: (row.order_item_modifiers ?? [])
          .map((m) => m.dish_modifier_options?.name)
          .filter((n): n is string => !!n)
          .join(', '),
        tableNumber: row.orders!.table_sessions?.tables?.table_number ?? '—',
        barTicketNumber: row.orders!.bar_ticket_number,
        cancellationRestocked: row.cancellation_restocked,
        cancellationReason: row.cancellation_reason,
        sessionAccountNumber: row.orders!.bar_ticket_number === null ? (row.orders!.table_sessions?.session_account_number ?? null) : null,
        subAccountNumber: row.orders!.bar_ticket_number === null ? (row.orders!.session_participants?.sub_account_number ?? null) : null,
      }))
      .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());

    setItems(mapped);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, items, refresh };
}
