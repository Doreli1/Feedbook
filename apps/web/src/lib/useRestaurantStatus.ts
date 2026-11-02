import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Restaurant active/inactive status (2026-11-02, schedule-only — user
// decision, no manual override unlike the bar's hybrid model). Used by
// TableStatusBoard.tsx to show "סגור" on an available table instead of
// "פנוי" once the restaurant's own hours say it's closed. Same two live-
// update mechanisms as useBarStatus.ts: a postgres_changes subscription on
// `restaurants` catches an hours edit from another screen/tab, and a
// periodic re-check catches the wall clock alone crossing a schedule
// boundary (which writes nothing to the DB for a subscription to catch).
// 15s (not 60s, 2026-11-02 — a minute felt far from "real time" when
// watching a status flip at its scheduled boundary) balances that
// perceived immediacy against needless load from a plain idle poll.
const POLL_INTERVAL_MS = 15_000;

export function useRestaurantStatus(restaurantId: string | undefined) {
  const [active, setActive] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setActive(null);
      return;
    }
    const { data } = await supabase.rpc('restaurant_is_active', { p_restaurant_id: restaurantId });
    setActive(data ?? null);
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!restaurantId) return;
    const channel = supabase
      .channel(`restaurant-status-${restaurantId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    // A tab left in the background (or another app) can sit well past a
    // throttled interval timer — re-checking the instant it's looked at
    // again is what actually makes a boundary crossed while away feel
    // caught up immediately instead of stale until the next tick.
    function onVisible() {
      if (document.visibilityState === 'visible') void refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [restaurantId, refresh]);

  return { active, refresh };
}
