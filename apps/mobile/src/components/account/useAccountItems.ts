import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useI18n } from '../../lib/i18n';

export interface AccountItem {
  id: string;
  participantId: string;
  dishName: string;
  quantity: number;
  unitPrice: number;
  // Set only for a row representing one PRICED modifier/add-on of a dish
  // (2026-10-11, user request) — a separate billing line, not folded into
  // the dish's own row, so the diner can see exactly what they're paying
  // extra for (e.g. "בירה (1/3 ליטר · בקבוק)" next to "סטייק אנטריקוט").
  // A free (price_delta_at_order = 0) modifier — like a doneness choice —
  // is never shown as its own row; there's nothing billable to separate
  // out. Carries everything update-order-item's 'update' action needs to
  // resubmit the item WITHOUT this one modifier, which is what "removing"
  // this row actually does server-side (the dish itself, its size, its
  // other modifiers, and its quantity are all otherwise untouched).
  removable: {
    orderItemId: string;
    status: string;
    placedAt: string;
    dishSizeOptionId: string | null;
    otherModifierSelections: { modifierOptionId: string; servingVariantId: string | null }[];
  } | null;
}

interface RawRow {
  id: string;
  quantity: number;
  unit_price: number;
  status: string;
  dish_size_option_id: string | null;
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

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('order_items')
      .select(
        'id, quantity, unit_price, status, dish_size_option_id, orders!inner(participant_id, session_id, placed_at), dishes!inner(name), order_item_modifiers(modifier_option_id, serving_variant_id, price_delta_at_order, dish_modifier_options(name), modifier_option_serving_variants(name, container_type))',
      )
      .eq('orders.session_id', sessionId)
      .neq('status', 'cancelled')
      .returns<RawRow[]>();

    const mapped: AccountItem[] = [];
    for (const row of data ?? []) {
      if (!row.orders || !row.dishes) continue;
      const modifiers = row.order_item_modifiers ?? [];
      const allSelections = modifiers.map((m) => ({ modifierOptionId: m.modifier_option_id, servingVariantId: m.serving_variant_id }));

      mapped.push({
        id: row.id,
        participantId: row.orders.participant_id,
        dishName: row.dishes.name,
        quantity: row.quantity,
        unitPrice: row.unit_price,
        removable: null,
      });

      modifiers
        .filter((m) => m.price_delta_at_order !== 0)
        .forEach((m) => {
          const optionName = m.dish_modifier_options?.name ?? '';
          const variant = m.modifier_option_serving_variants;
          const containerLabel = variant ? t(variant.container_type === 'bottle' ? 'dishServingContainerBottleLabel' : 'dishServingContainerDraftLabel') : null;
          mapped.push({
            id: `${row.id}-${m.modifier_option_id}-${m.serving_variant_id ?? 'none'}`,
            participantId: row.orders!.participant_id,
            dishName: variant ? `${optionName} (${variant.name} · ${containerLabel})` : optionName,
            quantity: row.quantity,
            unitPrice: m.price_delta_at_order,
            removable: {
              orderItemId: row.id,
              status: row.status,
              placedAt: row.orders!.placed_at,
              dishSizeOptionId: row.dish_size_option_id,
              otherModifierSelections: allSelections.filter(
                (s) => !(s.modifierOptionId === m.modifier_option_id && s.servingVariantId === m.serving_variant_id),
              ),
            },
          });
        });
    }

    setItems(mapped);
    setLoading(false);
  }, [sessionId, t]);

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
