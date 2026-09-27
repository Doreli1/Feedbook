import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { StaffDirectoryRow } from '@feedbook/types';

// Staff identity (name/email) can't be read via plain PostgREST — see
// list_restaurant_staff() in 20260906091000_staff_directory.sql — so this
// hook calls the RPC instead of `supabase.from('staff')`, unlike
// useMenu/useInventory/useTables.
export function useStaff(restaurantId: string | undefined) {
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setStaff([]);
      setLoading(false);
      return;
    }
    const { data, error: rpcError } = await supabase.rpc('list_restaurant_staff', { p_restaurant_id: restaurantId });
    setStaff(data ?? []);
    setError(rpcError?.message ?? null);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { loading, staff, error, refresh };
}
