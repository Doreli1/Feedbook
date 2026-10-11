import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { useI18n } from '../../lib/i18n';

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
  orders: { participant_id: string; session_id: string; placed_at: string } | null;
  dishes: { name: string } | null;
  order_item_modifiers:
    | {
        modifier_option_id: string;
        serving_variant_id: string | null;
        price_delta_at_order: number;
        dish_modifier_options: { name: string } | null;
        modifier_option_serving_variants: { name: string; container_type: string } | null;
      }[]
    | null;
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
  const { t } = useI18n();
  const [items, setItems] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('order_items')
      .select(
        'id, quantity, unit_price, orders!inner(participant_id, session_id, placed_at), dishes!inner(name), order_item_modifiers(modifier_option_id, serving_variant_id, price_delta_at_order, dish_modifier_options(name), modifier_option_serving_variants(name, container_type))',
      )
      .eq('orders.session_id', sessionId)
      .neq('status', 'cancelled')
      // Real bug (2026-10-11, user report): with no explicit order, a newly
      // placed/edited item could land anywhere in the result set — on a
      // long bill it read as "nothing updated" even though the row really
      // was there, just buried mid-list instead of appearing at the bottom
      // where a diner naturally looks for what they just added.
      .order('placed_at', { referencedTable: 'orders', ascending: true })
      .returns<RawRow[]>();

    const mapped: AccountItem[] = [];
    for (const row of data ?? []) {
      if (!row.orders || !row.dishes) continue;

      mapped.push({
        id: row.id,
        participantId: row.orders.participant_id,
        dishName: row.dishes.name,
        quantity: row.quantity,
        unitPrice: row.unit_price,
      });

      // Each PRICED modifier/add-on gets its own separate row (2026-10-11,
      // user request) — a free (price_delta_at_order = 0) one, like a
      // doneness choice, stays folded into the dish's own row above; there's
      // nothing billable to call out separately. Removing a priced add-on
      // is handled from the dish's own edit screen (DishDetailModal, via
      // OrderTracker's "בצעו שינויים במנה"), not from this billing view.
      for (const m of row.order_item_modifiers ?? []) {
        if (m.price_delta_at_order === 0) continue;
        const optionName = m.dish_modifier_options?.name ?? '';
        const variant = m.modifier_option_serving_variants;
        const containerLabel = variant ? t(variant.container_type === 'bottle' ? 'dishServingContainerBottleLabel' : 'dishServingContainerDraftLabel') : null;
        mapped.push({
          id: `${row.id}-${m.modifier_option_id}-${m.serving_variant_id ?? 'none'}`,
          participantId: row.orders.participant_id,
          dishName: variant ? `${optionName} (${variant.name} · ${containerLabel})` : optionName,
          quantity: row.quantity,
          unitPrice: m.price_delta_at_order,
        });
      }
    }

    setItems(mapped);
    setLoading(false);
  }, [sessionId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Real bug fix (2026-10-11, user report): a cancelled order with a
    // priced modifier kept showing — and the diner kept being billed for
    // it — in "ניהול חשבון" after the diner cancelled it. The query/RLS
    // side was verified correct end-to-end (a real cancel via a real
    // diner's own JWT immediately dropped out of this exact query). The
    // gap was here: this subscription never checked its own connection
    // status — nothing in this file (or almost anywhere else in this
    // codebase) did — so a channel that silently failed to establish
    // (CHANNEL_ERROR/TIMED_OUT) left this screen looking "live" while
    // actually never hearing about another participant's change again.
    // Still relevant even though AccountScreen fully remounts on every tab
    // switch (which alone would've masked this for whoever acted): "חשבון
    // כללי" is explicitly meant to update live for every OTHER diner at
    // the same table who never left this tab.
    function connect() {
      // Unique per-attempt suffix — see the matching comment in
      // useSessionParticipants.ts for why a name scoped only by sessionId
      // crashes with "cannot add postgres_changes callbacks ... after
      // subscribe()" across the account screen's unmount/remount-on-tab-
      // switch, and (now) across a retry of this same effect instance too.
      const channel = supabase
        .channel(`account-items-${sessionId}-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
          void refresh();
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            // Catches exactly the gap above: whatever changed while this
            // channel was down (including this device's own cancel, if it
            // raced the subscribe) is picked up the moment it's live again.
            void refresh();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('account-items realtime subscribe failed', status, err);
            void refresh();
            if (!cancelled) {
              void supabase.removeChannel(channel);
              retryTimer = setTimeout(connect, 3000);
            }
          }
        });
      channelRef.current = channel;
    }
    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
    };
  }, [sessionId, refresh]);

  return { loading, items, refresh };
}
