import type { Ingredient } from '@feedbook/types';
import type { TranslationKey } from './translations';

export interface IngredientStockStatus {
  cls: string;
  labelKey: TranslationKey;
}

// Shared by IngredientsScreen.tsx (the inventory list's own status pill) and
// MenuManager.tsx (ingredient tags colored by the same status, 2026-09-23) —
// extracted into one place so the two can never independently drift apart,
// the exact way the kitchen screen's active/history status colors once did
// earlier this session before that got the same treatment.
export function ingredientStockStatus(ingredient: Pick<Ingredient, 'quantity_in_stock' | 'threshold_quantity'>): IngredientStockStatus {
  if (ingredient.quantity_in_stock <= 0) return { cls: 'bg-danger-soft text-danger', labelKey: 'ingredientStatusOut' };
  if (ingredient.quantity_in_stock < ingredient.threshold_quantity) return { cls: 'bg-warning-soft text-warning', labelKey: 'ingredientStatusLow' };
  return { cls: 'bg-success-soft text-success', labelKey: 'ingredientStatusOk' };
}
