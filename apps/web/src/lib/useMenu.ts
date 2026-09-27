import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Dish, DishIngredient, DishSizeOption, MenuCategory } from '@feedbook/types';

export function useMenu(restaurantId: string | undefined) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [dishIngredients, setDishIngredients] = useState<DishIngredient[]>([]);
  const [dishSizeOptions, setDishSizeOptions] = useState<DishSizeOption[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!restaurantId) {
      setCategories([]);
      setDishes([]);
      setDishIngredients([]);
      setDishSizeOptions([]);
      setLoading(false);
      return;
    }
    const [categoriesRes, dishesRes] = await Promise.all([
      supabase.from('menu_categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('dishes').select('*').eq('restaurant_id', restaurantId).order('created_at'),
    ]);
    setCategories(categoriesRes.data ?? []);
    setDishes(dishesRes.data ?? []);

    // Recipe costing (dish profitability) needs every dish's linked
    // ingredients, and the dish list view needs every dish's size options
    // (for the "starting from" price) — both fetched in bulk here rather
    // than per-dish, since neither table has a restaurant_id column of its
    // own to filter on directly.
    const dishIds = (dishesRes.data ?? []).map((d) => d.id);
    const [dishIngredientsRes, dishSizeOptionsRes] = await Promise.all([
      dishIds.length ? supabase.from('dish_ingredients').select('*').in('dish_id', dishIds) : Promise.resolve({ data: [] as DishIngredient[] }),
      dishIds.length
        ? supabase.from('dish_size_options').select('*').in('dish_id', dishIds).order('sort_order')
        : Promise.resolve({ data: [] as DishSizeOption[] }),
    ]);
    setDishIngredients(dishIngredientsRes.data ?? []);
    setDishSizeOptions(dishSizeOptionsRes.data ?? []);

    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return { loading, categories, dishes, dishIngredients, dishSizeOptions, refresh };
}
