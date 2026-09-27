import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { OverheadExpense } from '@feedbook/types';

export const OVERHEAD_CATEGORIES = ['rent', 'utilities', 'labor', 'insurance', 'marketing', 'other'] as const;
export type OverheadCategory = (typeof OVERHEAD_CATEGORIES)[number];

// The previous FULL calendar month, not a rolling N-day window. Two reasons
// (2026-09-16 user feedback): (1) the entered figure is inherently a
// per-calendar-month cost (rent is billed for a specific month), so
// measuring sales against a window that straddles two different months
// makes the two numbers incomparable; (2) using the *current*, in-progress
// month instead would be calendar-aligned but degenerate right after the
// 1st (a handful of sales so far this month would produce a wildly
// unstable per-dish figure) — last month is always a complete, stable
// period. A day closed for any reason (a kosher-certified restaurant's
// mandatory Saturday closure, a holiday) needs no special handling here:
// it simply contributes zero rows to the count, which is already the
// economically correct outcome — the same rent recovered from fewer
// selling days should load more onto each dish sold, not be shrugged off.
function previousCalendarMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Mirrors useInventory.ts's shape — fetch + refresh callback. Also carries
// dishesSoldInWindow: the denominator ProfitabilityCard needs to turn a
// restaurant's total monthly overhead into a per-dish figure (industry-
// standard allocation: total overhead / units sold in the same period —
// see the migration's own comment for the sources this was checked
// against). Fetched here rather than duplicated in Dashboard.tsx since it
// only exists to serve this one calculation.
export function useOverheadExpenses(restaurantId: string | undefined) {
  const [expenses, setExpenses] = useState<OverheadExpense[]>([]);
  const [dishesSoldInWindow, setDishesSoldInWindow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setExpenses([]);
      setDishesSoldInWindow(null);
      setLoading(false);
      return;
    }
    const { start, end } = previousCalendarMonthRange();
    const [expensesRes, soldRes] = await Promise.all([
      supabase.from('overhead_expenses').select('*').eq('restaurant_id', restaurantId),
      supabase
        .from('order_items')
        .select('quantity, orders!inner(placed_at, table_sessions!inner(restaurant_id))')
        .eq('orders.table_sessions.restaurant_id', restaurantId)
        .neq('status', 'cancelled')
        .gte('orders.placed_at', start)
        .lt('orders.placed_at', end),
    ]);
    setExpenses(expensesRes.data ?? []);
    const soldRows = (soldRes.data ?? []) as { quantity: number }[];
    setDishesSoldInWindow(soldRows.length > 0 ? soldRows.reduce((sum, row) => sum + row.quantity, 0) : 0);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const totalMonthlyOverhead = expenses.reduce((sum, e) => sum + e.monthly_amount, 0);

  async function saveExpenses(amounts: Record<OverheadCategory, number>) {
    if (!restaurantId) return { error: null };
    const { error } = await supabase.from('overhead_expenses').upsert(
      OVERHEAD_CATEGORIES.map((category) => ({
        restaurant_id: restaurantId,
        category,
        monthly_amount: amounts[category],
      })),
      { onConflict: 'restaurant_id,category' },
    );
    if (!error) await refresh();
    return { error };
  }

  return { loading, expenses, totalMonthlyOverhead, dishesSoldInWindow, refresh, saveExpenses };
}
