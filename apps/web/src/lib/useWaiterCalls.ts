import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface KitchenWaiterCall {
  id: string;
  reason: string | null;
  createdAt: string;
  tableNumber: string;
}

interface RawRow {
  id: string;
  reason: string | null;
  created_at: string;
  table_sessions: { restaurant_id: string } | null;
  tables: { table_number: string } | null;
}

export function useWaiterCalls(restaurantId: string | undefined) {
  const [calls, setCalls] = useState<KitchenWaiterCall[]>([]);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setCalls([]);
      return;
    }
    const { data } = await supabase
      .from('waiter_calls')
      .select('id, reason, created_at, table_sessions!inner(restaurant_id), tables(table_number)')
      .eq('table_sessions.restaurant_id', restaurantId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .returns<RawRow[]>();

    setCalls(
      (data ?? []).map((row) => ({
        id: row.id,
        reason: row.reason,
        createdAt: row.created_at,
        tableNumber: row.tables?.table_number ?? '—',
      })),
    );
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function acknowledge(id: string) {
    await supabase.from('waiter_calls').update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() }).eq('id', id);
    void refresh();
  }

  return { calls, refresh, acknowledge };
}
