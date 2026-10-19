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
//
// Also scoped to the diner's current sessionId (2026-10-19, real gap
// reported: re-joining the same table for a new visit still showed order
// events from a forgotten earlier visit, since this only ever filtered by
// user_id). session_id is null on notifications sent before this column
// existed (20261019080000_notifications_session_scoped.sql) — those never
// match and simply stop appearing, which is the right outcome for rows
// with no session to scope them to, rather than leaving them as permanent
// cross-session noise. HeaderBellIcon only renders inside the ordering
// flow, where a live sessionId always exists; without one this returns
// nothing instead of falling back to the old unscoped-by-session behavior.
export function useNotifications(userId: string | undefined, sessionId: string | null | undefined) {
  const [notifications, setNotifications] = useState<DinerNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId || !sessionId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, sent_at, read_at, related_order_id, related_order_item_id')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
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
  }, [userId, sessionId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId || !sessionId) return;
    // Filtered to this session too — a channel scoped only to user_id would
    // still fire (and trigger a refetch) for a different, unrelated
    // session's events, the same cross-session bleed this hook's own query
    // filter now avoids.
    const channel = supabase
      .channel(`notifications-${userId}-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId},session_id=eq.${sessionId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [userId, sessionId, refresh]);

  const markRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt } : n)));
    await supabase.from('notifications').update({ read_at: readAt }).eq('id', id);
  }, []);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  return { loading, notifications, unreadCount, markRead };
}
