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

  // Live status (2026-10-15, TableStatusBoard) — scan-qr and close-session
  // both flip tables.status server-side as diners join/leave, same
  // unfiltered-subscribe-then-refetch shape Dashboard.tsx already uses for
  // ingredients/kitchen, RLS still correctly narrowing delivery to this
  // restaurant's own rows.
  useEffect(() => {
    if (!restaurantId) return;
    const channel = supabase
      .channel(`tables-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [restaurantId, refresh]);

  return { loading, tables, refresh };
}
