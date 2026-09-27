import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Ingredient, PurchaseOrder } from '@feedbook/types';

export function useInventory(restaurantId: string | undefined) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setIngredients([]);
      setPurchaseOrders([]);
      setLoading(false);
      return;
    }
    const [ingredientsRes, ordersRes] = await Promise.all([
      supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('purchase_orders').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
    ]);
    setIngredients(ingredientsRes.data ?? []);
    setPurchaseOrders(ordersRes.data ?? []);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { loading, ingredients, purchaseOrders, refresh };
}
