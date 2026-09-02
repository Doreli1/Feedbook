import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Restaurant } from '@feedbook/types';

export function useOwnRestaurant(session: Session | null) {
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
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
      setRestaurant(null);
      setLoading(false);
      hasLoadedOnce.current = true;
      return;
    }
    if (!hasLoadedOnce.current) setLoading(true);
    const { data, error } = await supabase
      .from('staff')
      .select('restaurants(*)')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error || !data?.restaurants) {
      setRestaurant(null);
    } else {
      setRestaurant(data.restaurants as Restaurant);
    }
    setLoading(false);
    hasLoadedOnce.current = true;
  }, [session]);

  useEffect(() => {
    hasLoadedOnce.current = false;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return { loading, restaurant, refresh };
}
