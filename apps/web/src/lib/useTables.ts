import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { RestaurantTable } from '@feedbook/types';

export function useTables(restaurantId: string | undefined) {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setTables([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('tables')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('table_number');
    setTables(data ?? []);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { loading, tables, refresh };
}
