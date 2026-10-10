import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface AccountItem {
  id: string;
  participantId: string;
  dishName: string;
  quantity: number;
  unitPrice: number;
}

interface RawRow {
  id: string;
  quantity: number;
  unit_price: number;
  orders: { participant_id: string; session_id: string } | null;
  dishes: { name: string } | null;
}

// חשבון כללי / חשבון אישי (מוקאפים 10.1/10.2) — every order_item for the
// whole session, same RLS reach already relied on by OrderTracker.tsx
// (orders.session_id, not participant-scoped: participant_read_session_
// orders/order_items, 2026-09-14) — "חשבון כללי" uses the full list as-is,
// "חשבון אישי" filters it client-side to the viewer's own participantId
// (AFD §3.10: "המנות שהסועד הזמין מתוך החשבון הכללי" — one query, two views
// of the same data, not two separate fetches).
//
// Cancelled items are left out here on purpose — this is a live running
// bill, not the staff-facing cancellation/audit history
// (useOrderHistory.ts's own job on the Web Admin side).
export function useAccountItems(sessionId: string | null) {
  const [items, setItems] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('order_items')
      .select('id, quantity, unit_price, orders!inner(participant_id, session_id), dishes!inner(name)')
      .eq('orders.session_id', sessionId)
      .neq('status', 'cancelled')
      .returns<RawRow[]>();

    setItems(
      (data ?? [])
        .filter((row) => row.orders && row.dishes)
        .map((row) => ({
          id: row.id,
          participantId: row.orders!.participant_id,
          dishName: row.dishes!.name,
          quantity: row.quantity,
          unitPrice: row.unit_price,
        })),
    );
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    // Unique per-mount suffix — see the matching comment in
    // useSessionParticipants.ts for why a name scoped only by sessionId
    // crashes with "cannot add postgres_changes callbacks ... after
    // subscribe()" across the account screen's unmount/remount-on-tab-switch.
    const channel = supabase
      .channel(`account-items-${sessionId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, refresh]);

  return { loading, items, refresh };
}
