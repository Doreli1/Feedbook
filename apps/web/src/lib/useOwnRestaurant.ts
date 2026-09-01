import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Restaurant } from '@feedbook/types';

export function useOwnRestaurant(session: Session | null) {
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setRestaurant(null);
      setLoading(false);
      return;
    }
    setLoading(true);
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
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, restaurant, refresh };
}
