import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { TranslationKey } from './translations';

export type BarManualOverride = 'open' | 'closed' | null;

function hasConfiguredRules(hours: unknown): boolean {
  const rules = (hours as { rules?: unknown[] } | null)?.rules;
  return Array.isArray(rules) && rules.length > 0;
}

// The "follow schedule" override option's label (2026-11-02, user request)
// names whichever schedule actually governs the bar right now, mirroring
// bar_is_active()'s own fallback order exactly (bar_hours, then the
// restaurant's general hours, then — nothing configured at all —
// "always active", since that's genuinely bar_is_active's own last-resort
// default, not a placeholder label).
export function followScheduleLabelKey(hasBarHours: boolean, hasGeneralHours: boolean): TranslationKey {
  if (hasBarHours) return 'barOverrideFollowBarHoursLabel';
  if (hasGeneralHours) return 'barOverrideFollowGeneralHoursLabel';
  return 'barOverrideAlwaysActiveLabel';
}

// Shared by BarOrdersScreen's status card and TableStatusBoard's bar row
// (2026-11-02) — both need the exact same "is the bar active right now"
// answer, so this is the one place that computes it. Calls
// bar_close_if_inactive (not plain bar_is_active): loading either screen is
// one of the two moments this project lazily auto-closes a lingering open
// bar session once the bar has gone inactive (a scan-qr attempt is the
// other) — there's no cron to do that on a schedule instead.
//
// Live updates (2026-11-02, user request — "כל השינויים יחולו בתצוגת
// המערכת בזמן אמת"): two different kinds of change can flip the answer,
// and they need two different mechanisms, since neither covers the other.
// (1) A DB write — the override toggled from another tab/screen, or the
// bar/restaurant hours edited — is covered by a postgres_changes
// subscription on `restaurants`, same unfiltered-subscribe-then-refetch
// shape Dashboard.tsx already uses elsewhere (RLS still correctly narrows
// delivery to rows this viewer can read). (2) The wall clock alone
// crossing a schedule boundary writes nothing to the DB at all — there is
// no row change to subscribe to — so that direction is covered by a
// periodic re-check instead, same interval either screen would otherwise
// need on its own. 15s (not 60s, 2026-11-02 — a minute felt far from "real
// time" when watching a status flip at its scheduled boundary) balances
// that perceived immediacy against needless load from a plain idle poll.
const POLL_INTERVAL_MS = 15_000;

export function useBarStatus(restaurantId: string | undefined) {
  const [active, setActive] = useState<boolean | null>(null);
  const [override, setOverride] = useState<BarManualOverride>(null);
  const [hasBarHours, setHasBarHours] = useState(false);
  const [hasGeneralHours, setHasGeneralHours] = useState(false);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setActive(null);
      setOverride(null);
      setHasBarHours(false);
      setHasGeneralHours(false);
      return;
    }
    const [{ data: activeData }, { data: restaurantData }] = await Promise.all([
      supabase.rpc('bar_close_if_inactive', { p_restaurant_id: restaurantId }),
      supabase.from('restaurants').select('bar_manual_override, bar_hours, hours').eq('id', restaurantId).single(),
    ]);
    setActive(activeData ?? null);
    setOverride((restaurantData?.bar_manual_override as BarManualOverride) ?? null);
    setHasBarHours(hasConfiguredRules(restaurantData?.bar_hours));
    setHasGeneralHours(hasConfiguredRules(restaurantData?.hours));
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!restaurantId) return;
    const channel = supabase
      .channel(`bar-status-${restaurantId}`)
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

  return { active, override, hasBarHours, hasGeneralHours, refresh };
}
