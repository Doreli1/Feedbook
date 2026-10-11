import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export type WaiterCallStatus = 'open' | 'resolved';

export interface KitchenWaiterCall {
  id: string;
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  tableNumber: string;
  status: WaiterCallStatus;
}

interface RawRow {
  id: string;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  status: WaiterCallStatus;
  table_sessions: { restaurant_id: string } | null;
  tables: { table_number: string } | null;
}

// Per PRD §5.1.4 / API Specification §10.2 (confirmed 2026-10-11, superseding
// the earlier 'acknowledged' middle state this hook briefly had): the
// documented flow is a direct open → resolved transition only, done through
// resolve-waiter-call (role='waiter' only, see that function's own comment).
// 'acknowledged' stays a valid DB status value (nothing drops the column/
// check constraint) but nothing in this app sets it anymore.
//
// Fetches full history (no date cutoff) — same convention as
// useOrderHistory.ts ("fetches every order_item ever placed... regardless of
// status"), since ServiceScreen.tsx now groups resolved calls by day itself
// (2026-10-11, user request) rather than this hook silently hiding anything
// older than today.
export function useWaiterCalls(restaurantId: string | undefined) {
  const [calls, setCalls] = useState<KitchenWaiterCall[]>([]);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setCalls([]);
      return;
    }
    const { data } = await supabase
      .from('waiter_calls')
      .select('id, reason, created_at, resolved_at, status, table_sessions!inner(restaurant_id), tables(table_number)')
      .eq('table_sessions.restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .returns<RawRow[]>();

    setCalls(
      (data ?? []).map((row) => ({
        id: row.id,
        reason: row.reason,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        tableNumber: row.tables?.table_number ?? '—',
        status: row.status === 'resolved' ? 'resolved' : 'open',
      })),
    );
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Role-gated server-side (resolve-waiter-call: role='waiter' only) and at
  // the RLS layer (waiter_resolve_own_restaurant_waiter_calls) — a non-
  // waiter calling this just gets a 403 back, surfaced as a thrown error for
  // the caller to show.
  async function resolve(id: string) {
    const { data, error } = await supabase.functions.invoke<{ error?: { code: string; message: string } }>('resolve-waiter-call', {
      body: { waiter_call_id: id },
    });
    if (error || data?.error) {
      throw new Error(data?.error?.message ?? 'Failed to resolve the call');
    }
    void refresh();
  }

  return { calls, refresh, resolve };
}
