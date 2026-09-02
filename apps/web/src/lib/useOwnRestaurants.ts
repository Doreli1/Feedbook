import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Restaurant } from '@feedbook/types';

// A user can be an active manager at more than one restaurant (staff is a
// proper many-to-many join), so this always fetches the full list — never
// .maybeSingle(), which silently mis-reported "no restaurant" for anyone
// with more than one staff row.
export function useOwnRestaurants(session: Session | null) {
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  // Only the very first load should show a full-page loading state. A later
  // refresh() call (e.g. after a kosher-certificate upload) toggling
  // `loading` back to true would swap the wizard out for LoadingScreen and
  // back — a different component at the same tree position, so React
  // remounts whatever comes back, silently resetting the wizard's own local
  // step state to its initial value. Caught by watching the actual UI jump
  // back to screen 1 after an upload, not by reading the code.
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setRestaurants([]);
      setLoading(false);
      hasLoadedOnce.current = true;
      return;
    }
    if (!hasLoadedOnce.current) setLoading(true);
    const { data, error } = await supabase.from('staff').select('restaurants(*)').eq('user_id', session.user.id);

    if (error || !data) {
      setRestaurants([]);
    } else {
      setRestaurants(data.map((row) => row.restaurants).filter((r): r is Restaurant => r !== null));
    }
    setLoading(false);
    hasLoadedOnce.current = true;
  }, [session]);

  useEffect(() => {
    hasLoadedOnce.current = false;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return { loading, restaurants, refresh };
}
