import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface PaymentNotification {
  id: string;
  title: string;
  body: string;
  sentAt: string;
  readAt: string | null;
}

interface RawRow {
  id: string;
  title: string;
  body: string;
  sent_at: string;
  read_at: string | null;
}

// Mail-icon "payment completed" messages (2026-11-08, real feature — see
// confirm-cash-payment/index.ts and 20261108100000_cash_payment_confirmation.sql).
// Unlike useNotifications.ts (order events, deliberately scoped to the
// diner's CURRENT sessionId — see that hook's own comment), this is NOT
// session-scoped: the whole point of this message is that it survives
// after the table_session it's about is long closed, so the diner can
// still find it later from their profile screen. Same `notifications`
// table, same per-user RLS, just a different `type` and no session filter.
export function usePaymentNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<PaymentNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, sent_at, read_at')
      .eq('user_id', userId)
      .eq('type', 'payment_completed')
      .order('sent_at', { ascending: false })
      .limit(20)
      .returns<RawRow[]>();

    setNotifications(
      (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        sentAt: row.sent_at,
        readAt: row.read_at,
      })),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`payment-notifications-${userId}`)
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
