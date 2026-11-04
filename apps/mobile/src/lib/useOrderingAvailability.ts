import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

// Live "can the diner still order this right now" signal for an already-open
// session (2026-11-04, user request) — distinct from resolveTableToken.ts's
// own RESTAURANT_NOT_ACTIVE/BAR_NOT_ACTIVE handling, which only ever runs
// once, at scan time. A diner who scanned in while everything was open can
// still be sitting there browsing the menu when the kitchen's own cutoff or
// the bar's own schedule/override flips mid-visit — this is what keeps
// MenuBrowser's section tabs (and OrderingScreen's own bottom notice)
// current without the diner needing to back out and rescan to find out.
//
// Same realtime-subscription + periodic-poll shape as Web Admin's
// useBarStatus.ts (apps/web/src/lib/useBarStatus.ts) and for the same two
// reasons: a DB write (staff toggled the bar's manual override, or edited
// hours) is covered by the postgres_changes subscription on `restaurants`;
// the wall clock alone crossing a schedule boundary writes nothing, so a
// 15s poll covers that direction. AppState's 'active' event is this app's
// equivalent of that hook's document.visibilitychange — catches a boundary
// crossed while the app sat backgrounded past a throttled timer.
const POLL_INTERVAL_MS = 15_000;

export function useOrderingAvailability(restaurantId: string | null, isBarTable: boolean) {
  const [kitchenOpen, setKitchenOpen] = useState<boolean | null>(null);
  // null when not seated at the bar — the diner's own ordering is never
  // gated by the bar's status from a regular table (place_order_transaction
  // only checks bar_is_active for table_type='bar' sessions), so there's no
  // "bar closed" state to track there at all, not just nothing to show.
  const [barActive, setBarActive] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setKitchenOpen(null);
      setBarActive(null);
      return;
    }
    // bar_close_if_inactive (not plain bar_is_active), same reasoning as
    // useBarStatus.ts: this is one of the moments this project lazily
    // auto-closes a lingering open bar session once the bar's gone
    // inactive — real for this diner's own session too, not just staff
    // screens.
    const [kitchenResult, barResult] = await Promise.all([
      supabase.rpc('kitchen_is_open', { p_restaurant_id: restaurantId }),
      isBarTable ? supabase.rpc('bar_close_if_inactive', { p_restaurant_id: restaurantId }) : Promise.resolve({ data: null }),
    ]);
    setKitchenOpen((kitchenResult.data as boolean | null) ?? null);
    setBarActive(isBarTable ? ((barResult.data as boolean | null) ?? null) : null);
  }, [restaurantId, isBarTable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!restaurantId) return;
    const channel = supabase
      .channel(`ordering-availability-${restaurantId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(interval);
      subscription.remove();
    };
  }, [restaurantId, refresh]);

  return { kitchenOpen, barActive };
}
