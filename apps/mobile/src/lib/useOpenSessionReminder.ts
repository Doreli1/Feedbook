import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface OpenSessionReminder {
  sessionId: string;
  restaurantName: string;
  tableNumber: string;
}

// Mail-icon "open visit" reminder (2026-10-16, user request): a diner who
// loses track of an open, unpaid table session (e.g. the local
// tableSessionStore was cleared, or they simply closed the app) has no way
// to find their way back to it otherwise — see Implementation Plan §14.
// get_my_open_session() is a security definer RPC (same cross-RLS-boundary
// pattern as current_staff_restaurant_ids()) since a diner's client has no
// read grant on `tables` at all; this returns only the minimal display
// fields, never raw row access. Fetched once per mount (profile.tsx,
// OrderingHeader.tsx) rather than subscribed live — this is a gentle
// reminder, not a real-time feed.
export function useOpenSessionReminder(userId: string | undefined) {
  const [reminder, setReminder] = useState<OpenSessionReminder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setReminder(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      const { data } = await supabase.rpc('get_my_open_session').maybeSingle();
      if (cancelled) return;
      setReminder(
        data ? { sessionId: data.session_id, restaurantName: data.restaurant_name, tableNumber: data.table_number } : null,
      );
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { reminder, loading };
}
