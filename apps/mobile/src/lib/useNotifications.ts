import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface DinerNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  // Set on exactly one of these depending on the event kind — see
  // 20260919170000_notifications_related_records.sql — so tapping a
  // notification can navigate to the Orders tab and highlight the item
  // it's about, not just mark it read.
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

// Diner-facing counterpart of the web admin's useNotifications.ts — same
// `notifications` table (20260919120000_order_event_notifications.sql),
// same RLS (a signed-in user reads/marks-read only their own user_id rows),
// same per-notification (not mark-all-on-open) read semantics. Fed by
// place_order_transaction ("your order was placed") and
// notify_order_item_cancelled ("your order was cancelled").
export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<DinerNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, sent_at, read_at, related_order_id, related_order_item_id')
      .eq('user_id', userId)
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
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [userId, refresh]);

  const markRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt } : n)));
    await supabase.from('notifications').update({ read_at: readAt }).eq('id', id);
  }, []);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  return { loading, notifications, unreadCount, markRead };
}
