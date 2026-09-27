import type { Dish, DishIngredient, Ingredient } from '@feedbook/types';
import { useI18n } from '../lib/i18n';

interface Props {
  dishes: Dish[];
  dishIngredients: DishIngredient[];
  ingredients: Ingredient[];
  vatRatePercent: number;
  totalMonthlyOverhead: number;
  dishesSoldInWindow: number | null;
}

interface DishProfitability {
  dish: Dish;
  basePrice: number;
  directCost: number | null;
  indirectCost: number | null;
  profit: number | null;
  marginPct: number | null;
}

// Real recipe costing — dish.price (VAT-inclusive, as required by Israeli
// menu-pricing law) converted to its pre-VAT base price, minus direct cost
// (linked ingredients' unit_cost × quantity_required) and indirect cost
// (this restaurant's total monthly overhead ÷ dishes sold in the same
// ~30-day window — the standard allocation method per restaurant
// cost-accounting guides, added 2026-09-16; previously this card only ever
// subtracted direct cost, silently ignoring rent/labor/utilities/etc.).
// Deliberately returns `directCost: null` (never 0) for a dish with no
// recipe defined yet, or where any required ingredient is missing a cost —
// a false "100% margin" from silently treating unknown cost as free would
// be worse than admitting the number isn't known yet. `indirectCost` is
// separately nullable: a dish's recipe can be fully known while there's
// still no sales history yet to allocate overhead against.
function computeProfitability(
  dishes: Dish[],
  dishIngredients: DishIngredient[],
  ingredients: Ingredient[],
  vatRatePercent: number,
  totalMonthlyOverhead: number,
  dishesSoldInWindow: number | null,
): DishProfitability[] {
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  const indirectCostPerDish = dishesSoldInWindow != null && dishesSoldInWindow > 0 ? totalMonthlyOverhead / dishesSoldInWindow : null;

  return dishes.map((dish) => {
    const basePrice = dish.price / (1 + vatRatePercent / 100);
    const links = dishIngredients.filter((di) => di.dish_id === dish.id);
    if (links.length === 0) return { dish, basePrice, directCost: null, indirectCost: null, profit: null, marginPct: null };

    let directCost = 0;
    for (const link of links) {
      const ingredient = ingredientById.get(link.ingredient_id);
      if (!ingredient || ingredient.unit_cost == null) {
        return { dish, basePrice, directCost: null, indirectCost: null, profit: null, marginPct: null };
      }
      directCost += ingredient.unit_cost * link.quantity_required;
    }
    const profit = basePrice - directCost - (indirectCostPerDish ?? 0);
    const marginPct = basePrice > 0 ? (profit / basePrice) * 100 : null;
    return { dish, basePrice, directCost, indirectCost: indirectCostPerDish, profit, marginPct };
  });
}

export function ProfitabilityCard({ dishes, dishIngredients, ingredients, vatRatePercent, totalMonthlyOverhead, dishesSoldInWindow }: Props) {
  const { t } = useI18n();
  const rows = computeProfitability(dishes, dishIngredients, ingredients, vatRatePercent, totalMonthlyOverhead, dishesSoldInWindow).sort(
    (a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity),
  );
  const indirectCostMissing = totalMonthlyOverhead > 0 && !dishesSoldInWindow;

  return (
    <div className="card p-6">
      <h2 className="mb-1 text-sm font-semibold text-ink">{t('profitabilityHeading')}</h2>
      <p className="mb-1 text-xs text-muted-foreground">{t('profitabilitySubtitle')}</p>
      <p className="mb-4 text-[11px] text-muted-foreground">{t('profitabilityMethodologyNote').replace('{vat}', String(vatRatePercent))}</p>

      {indirectCostMissing && (
        <div className="mb-4 rounded border-l-4 border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
          {t('profitabilityNoSalesDataYet')}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('profitabilityEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-start text-eyebrow">{t('profitabilityColumnDish')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('profitabilityColumnBasePrice')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('profitabilityColumnCost')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('profitabilityColumnProfit')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('profitabilityColumnMargin')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ dish, basePrice, directCost, indirectCost, profit, marginPct }) => (
                <tr key={dish.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-2 py-2.5 font-medium text-ink">{dish.name}</td>
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">₪{basePrice.toFixed(2)}</td>
                  {directCost === null ? (
                    <td colSpan={3} className="px-2 py-2.5 text-xs text-muted-foreground">
                      {t('profitabilityMissingData')}
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">
                        <div>
                          {t('profitabilityDirectCostLabel')} ₪{directCost.toFixed(2)}
                        </div>
                        <div>{indirectCost === null ? t('profitabilityIndirectCostUnknown') : `${t('profitabilityIndirectCostLabel')} ₪${indirectCost.toFixed(2)}`}</div>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums font-medium text-ink">₪{profit!.toFixed(2)}</td>
                      <td className="px-2 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                            marginPct! >= 50
                              ? 'bg-success-soft text-success'
                              : marginPct! >= 20
                                ? 'bg-warning-soft text-warning'
                                : 'bg-danger-soft text-danger'
                          }`}
                        >
                          {marginPct!.toFixed(0)}%
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
