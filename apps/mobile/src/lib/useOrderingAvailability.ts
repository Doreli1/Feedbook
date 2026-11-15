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
  // Real gap found live (2026-11-10): a regular table had no live signal at
  // all for "the restaurant's own hours have fully ended" — only kitchenOpen
  // (which only ever narrows food out, drinks stay orderable past it, see
  // kitchen_closing_cutoff.sql's own 2026-11-02 decision) was tracked, so an
  // already-seated diner could keep ordering drinks indefinitely with no
  // notice. null when seated at the bar — bar_is_active already hard-gates
  // on restaurant_is_active itself (20261102120000_bar_bounded_by_
  // restaurant_hours.sql), so barActive alone already covers a bar table;
  // this is only ever used/shown for a regular table.
  const [restaurantActive, setRestaurantActive] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setKitchenOpen(null);
      setBarActive(null);
      setRestaurantActive(null);
      return;
    }
    // bar_close_if_inactive (not plain bar_is_active), same reasoning as
    // useBarStatus.ts: this is one of the moments this project lazily
    // auto-closes a lingering open bar session once the bar's gone
    // inactive — real for this diner's own session too, not just staff
    // screens.
    const [kitchenResult, barResult, restaurantResult] = await Promise.all([
      supabase.rpc('kitchen_is_open', { p_restaurant_id: restaurantId }),
      isBarTable ? supabase.rpc('bar_close_if_inactive', { p_restaurant_id: restaurantId }) : Promise.resolve({ data: null }),
      isBarTable ? Promise.resolve({ data: null }) : supabase.rpc('restaurant_is_active', { p_restaurant_id: restaurantId }),
    ]);
    setKitchenOpen((kitchenResult.data as boolean | null) ?? null);
    setBarActive(isBarTable ? ((barResult.data as boolean | null) ?? null) : null);
    setRestaurantActive(isBarTable ? null : ((restaurantResult.data as boolean | null) ?? null));
  }, [restaurantId, isBarTable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!restaurantId) return;
    // Unique per-mount suffix (real crash found live 2026-11-09: "cannot add
    // `postgres_changes` callbacks for realtime:ordering-availability-<id>
    // after `subscribe()`", a hard Render Error, not a caught warning —
    // crashed the whole menu screen white/red right after join-session,
    // intermittently, exactly matching useAccountItems.ts's/
    // useSessionParticipants.ts's own fix for this identical bug class: a
    // channel named only by a stable id is the SAME object across a fast
    // remount whose previous cleanup hasn't finished yet, and re-adding a
    // postgres_changes listener to an already-`subscribe()`d channel throws.
    // This hook was added 2026-11-04, after that lesson, without carrying it
    // forward. See those two files' own comments for the fuller history.
    const channel = supabase
      .channel(`ordering-availability-${restaurantId}-${Math.random().toString(36).slice(2)}`)
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

  return { kitchenOpen, barActive, restaurantActive };
}
