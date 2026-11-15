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
      // Real bug found live (2026-11-09): this had no `type` filter at all,
      // which was harmless only because 'payment_completed' (added the
      // same week — see usePaymentNotifications.ts) didn't exist yet when
      // it was written. Once confirm-card-payment/confirm-cash-payment
      // started inserting that type WITH a session_id set (so
      // usePaymentNotifications.ts's own mail-icon list can still find it
      // after the session closes), this bell — reserved for order events
      // only, see this hook's own comment above — started showing it too.
      // Excluded explicitly rather than allow-listing every real type, so
      // a future order-event type still works here without another edit.
      .neq('type', 'payment_completed')
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
    // Initial fetch on mount/userId-sessionId change — synchronous
    // setLoading(true) here is paired with refresh()'s own setLoading(false)
    // once its await resolves, not a value derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId || !sessionId) return;
    // Filtered to this session too — a channel scoped only to user_id would
    // still fire (and trigger a refetch) for a different, unrelated
    // session's events, the same cross-session bleed this hook's own query
    // filter now avoids. Unique per-mount suffix too (real crash found live
    // 2026-11-09 in useOrderingAvailability.ts's own channel — see that
    // file's comment for the full "cannot add postgres_changes callbacks
    // ... after subscribe()" story): this bell renders on every post-auth
    // screen, so it remounts constantly.
    const channel = supabase
      .channel(`notifications-${userId}-${sessionId}-${Math.random().toString(36).slice(2)}`)
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
