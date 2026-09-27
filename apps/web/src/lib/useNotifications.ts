import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface StaffNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  // Set on exactly one of these depending on the event kind — see
  // 20260919170000_notifications_related_records.sql — so clicking a
  // notification can navigate to the record it's about, not just mark it
  // read. Both null for notifications from before that migration.
  relatedOrderId: string | null;
  relatedOrderItemId: string | null;
}

interface RawRow {
  id: string;
  type: string;
  title: string;
  body: string;
  sent_at: string;
  read_at: string | null;
  related_order_id: string | null;
  related_order_item_id: string | null;
}

// Persisted, per-staff-member notifications (order placed / order item
// cancelled — see 20260919120000_order_event_notifications.sql) — unlike
// the low-stock alert on Dashboard.tsx (a live-computed, always-current
// state with no read/unread concept), these are real event rows in the
// `notifications` table that must be marked read individually and survive
// refresh/login on any device, per the user's explicit answer when this
// feature was scoped.
//
// `notifications.staff_id` references `staff.id`, which is itself
// restaurant-scoped (one row per user per restaurant) — so this first
// resolves the caller's own staff.id for THIS restaurant (a user working at
// two restaurants has two different staff rows, and Dashboard is always
// scoped to one restaurant at a time), then fetches only that staff row's
// notifications, never the other restaurant's.
export function useNotifications(restaurantId: string | undefined, userId: string | undefined) {
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId || !userId) {
      setNotifications([]);
      setStaffId(null);
      setLoading(false);
      return;
    }
    const { data: staffRow } = await supabase
      .from('staff')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!staffRow) {
      setNotifications([]);
      setStaffId(null);
      setLoading(false);
      return;
    }
    setStaffId(staffRow.id);

    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, sent_at, read_at, related_order_id, related_order_item_id')
      .eq('staff_id', staffRow.id)
      .order('sent_at', { ascending: false })
      .limit(50)
      .returns<RawRow[]>();

    setNotifications(
      (data ?? []).map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        sentAt: row.sent_at,
        readAt: row.read_at,
        relatedOrderId: row.related_order_id,
        relatedOrderItemId: row.related_order_item_id,
      })),
    );
    setLoading(false);
  }, [restaurantId, userId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Realtime: same unfiltered-plus-RLS reasoning would apply here too, but
  // `notifications.staff_id` (unlike order_items) is a plain column on the
  // row itself, so this can filter server-side directly — no need for the
  // broader "subscribe unfiltered, let RLS narrow delivery" pattern used for
  // order_items/waiter_calls.
  useEffect(() => {
    if (!staffId) return;
    const channel = supabase
      .channel(`notifications-${staffId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `staff_id=eq.${staffId}` }, () => void refresh())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [staffId, refresh]);

  const markRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt } : n)));
    await supabase.from('notifications').update({ read_at: readAt }).eq('id', id);
  }, []);

  return { loading, notifications, markRead, refresh };
}
