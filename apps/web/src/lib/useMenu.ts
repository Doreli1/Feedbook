import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Dish, MenuCategory } from '@feedbook/types';

export function useMenu(restaurantId: string | undefined) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setCategories([]);
      setDishes([]);
      setLoading(false);
      return;
    }
    const [categoriesRes, dishesRes] = await Promise.all([
      supabase.from('menu_categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('dishes').select('*').eq('restaurant_id', restaurantId).order('created_at'),
    ]);
    setCategories(categoriesRes.data ?? []);
    setDishes(dishesRes.data ?? []);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { loading, categories, dishes, refresh };
}
