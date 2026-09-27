import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Ingredient, IngredientUnit } from '@feedbook/types';
import { TrashIcon, PencilIcon, InfoIcon } from '../components/Icons';
import { FieldLabel } from '../components/FieldLabel';
import { Tooltip } from '../components/Tooltip';
import { IngredientImportModal } from '../components/IngredientImportModal';
import { useI18n } from '../lib/i18n';
import { ingredientStockStatus } from '../lib/ingredientStatus';

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  onRefresh: () => void;
  // Ids of ingredients currently driving the inventory tab's own badge
  // count (Dashboard.tsx's `lowStock` list) — surfaced here as a small red
  // dot per row (2026-09-23) so the specific recent change behind that
  // count (e.g. "בשר בקר" crossing into "כמעט נגמר") is visible right on
  // the row, not just as a number on the bell/tab. Deliberately the same
  // set as the badge, unfiltered by acknowledgment — the badge itself never
  // decreases just because an alert was seen (the ingredient is still
  // genuinely low), so the dot shouldn't either.
  alertIngredientIds?: Set<string>;
}

export function IngredientsScreen({ restaurantId, ingredients, onRefresh, alertIngredientIds }: Props) {
  const { t } = useI18n();
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function handleDelete(id: string) {
    await supabase.from('ingredients').delete().eq('id', id);
    onRefresh();
  }

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-lg font-bold text-ink">{t('ingredientsTitle')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('ingredientsSubtitle')}</p>

      {ingredients.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnName')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnSku')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnStock')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnThreshold')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnUnitCost')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnSupplier')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnStatus')}</th>
                <th className="px-2 py-2 text-start text-eyebrow">{t('ingredientColumnActions')}</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ingredient) =>
                editingId === ingredient.id ? (
                  <tr key={ingredient.id} className="border-b border-border last:border-0">
                    <td colSpan={8} className="p-0">
                      <IngredientForm
                        ingredient={ingredient}
                        restaurantId={restaurantId}
                        onDone={() => {
                          setEditingId(null);
                          onRefresh();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <IngredientTableRow
                    key={ingredient.id}
                    ingredient={ingredient}
                    hasAlert={alertIngredientIds?.has(ingredient.id) ?? false}
                    onEdit={() => setEditingId(ingredient.id)}
                    onDelete={() => void handleDelete(ingredient.id)}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {addingNew ? (
        <IngredientForm
          restaurantId={restaurantId}
          onDone={() => {
            setAddingNew(false);
            onRefresh();
          }}
          onCancel={() => setAddingNew(false)}
        />
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="flex-1 rounded border border-dashed border-border-strong py-2 text-sm text-accent hover:bg-accent-soft"
          >
            {t('addIngredient')}
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex-1 rounded border border-dashed border-border-strong py-2 text-sm text-accent hover:bg-accent-soft"
          >
            {t('ingredientImportButton')}
          </button>
        </div>
      )}

      {importOpen && (
        <IngredientImportModal
          restaurantId={restaurantId}
          existingSkus={new Set(ingredients.map((i) => i.sku))}
          onDone={onRefresh}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

// Built on the shared `Tooltip` (2026-09-24) — was its own hand-rolled
// portal+bubble before that component existed (see Tooltip.tsx for why a
// portal at all: this dot lives inside the ingredients table's
// `overflow-x-auto` wrapper, which silently clips a plain `absolute`
// bubble). Only the richer content (a blue "!" next to the message, instead
// of plain text) and the focusable dot itself are specific to this call site.
function AlertDot({ label, detail }: { label: string; detail: string }) {
  return (
    <Tooltip
      content={
        <div className="flex items-start gap-1.5">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
          <span>{detail}</span>
        </div>
      }
    >
      <span tabIndex={0} role="button" aria-label={`${label} — ${detail}`} className="h-2 w-2 shrink-0 rounded-full bg-danger outline-none" />
    </Tooltip>
  );
}

function IngredientTableRow({
  ingredient,
  hasAlert,
  onEdit,
  onDelete,
}: {
  ingredient: Ingredient;
  hasAlert: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { cls, labelKey } = ingredientStockStatus(ingredient);
  const status = { cls, label: t(labelKey) };
  const alertDetail = t('ingredientAlertBubbleMessage')
    .replace('{stock}', String(ingredient.quantity_in_stock))
    .replaceAll('{unit}', ingredient.unit)
    .replace('{threshold}', String(ingredient.threshold_quantity));

  return (
    // The whole row opens edit mode on click (2026-09-23), not just the
    // pencil button — the pencil stays as an explicit, discoverable
    // affordance, but every hover point over the row now offers the same
    // action. The delete button stops propagation so removing a row never
    // also opens it for editing first.
    <tr onClick={onEdit} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2">
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1.5">
          {hasAlert && <AlertDot label={t('ingredientAlertDotLabel')} detail={alertDetail} />}
          <span className="font-medium text-ink">{ingredient.name}</span>
        </div>
      </td>
      <td className="px-2 py-2.5 text-muted-foreground">{ingredient.sku}</td>
      <td className="px-2 py-2.5 tabular-nums">
        {ingredient.quantity_in_stock} {ingredient.unit}
      </td>
      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">
        {ingredient.threshold_quantity} {ingredient.unit}
      </td>
      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{ingredient.unit_cost != null ? `₪${ingredient.unit_cost}/${ingredient.unit}` : '—'}</td>
      <td className="px-2 py-2.5 text-muted-foreground">{ingredient.supplier_info || '—'}</td>
      <td className="px-2 py-2.5">
        <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1">
          <Tooltip content={t('editIngredient')}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label={t('editIngredient')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent-soft hover:text-accent"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content={t('deleteIngredient')}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={t('deleteIngredient')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}

function IngredientForm({
  ingredient,
  restaurantId,
  onDone,
  onCancel,
}: {
  ingredient?: Ingredient;
  restaurantId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(ingredient?.name ?? '');
  const [sku, setSku] = useState(ingredient?.sku ?? '');
  const [unit, setUnit] = useState(ingredient?.unit ?? '');
  const [stock, setStock] = useState(ingredient ? String(ingredient.quantity_in_stock) : '0');
  const [threshold, setThreshold] = useState(ingredient ? String(ingredient.threshold_quantity) : '0');
  const [unitCost, setUnitCost] = useState(ingredient?.unit_cost != null ? String(ingredient.unit_cost) : '');
  const [supplierInfo, setSupplierInfo] = useState(ingredient?.supplier_info ?? '');
  const [units, setUnits] = useState<{ id?: string; name: string; conversion: string }[]>([]);
  // Tracks which ingredient_units rows existed at load time, separately
  // from `units` — needed because a unit's id can be referenced by
  // dish_ingredients.unit_id / modifier_option_ingredients.unit_id
  // (on delete restrict), so saving can't just delete-everything-then-
  // reinsert like every other "replace the full set" section in this
  // codebase: that would try to delete a still-in-use row and fail. Existing
  // rows are updated in place (keeping their id, and therefore every
  // recipe's link to them, intact); only rows the user actually removed are
  // deleted, and only those.
  const [originalUnitIds, setOriginalUnitIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ingredient) return;
    void supabase
      .from('ingredient_units')
      .select('*')
      .eq('ingredient_id', ingredient.id)
      .order('sort_order')
      .then(({ data }) => {
        const rows = (data ?? []) as IngredientUnit[];
        setUnits(rows.map((u) => ({ id: u.id, name: u.name, conversion: String(u.conversion_to_stock_unit) })));
        setOriginalUnitIds(new Set(rows.map((u) => u.id)));
      });
    // ingredient.id is stable for the lifetime of an edit session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addUnitRow() {
    setUnits((prev) => [...prev, { name: '', conversion: '' }]);
  }

  function updateUnitRow(index: number, patch: Partial<{ name: string; conversion: string }>) {
    setUnits((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeUnitRow(index: number) {
    setUnits((prev) => prev.filter((_, i) => i !== index));
  }

  const validUnitRows = units.filter((u) => u.name.trim() !== '' && u.conversion.trim() !== '');
  const unitsValid = units.every(
    (u) =>
      (u.name.trim() === '' && u.conversion.trim() === '') ||
      (u.name.trim() !== '' && u.conversion.trim() !== '' && Number.isFinite(Number(u.conversion)) && Number(u.conversion) > 0),
  );

  const stockValue = Number(stock);
  const thresholdValue = Number(threshold);
  const unitCostValue = unitCost.trim() === '' ? null : Number(unitCost);
  const canSave =
    name.trim() !== '' &&
    sku.trim() !== '' &&
    unit.trim() !== '' &&
    !Number.isNaN(stockValue) &&
    stockValue >= 0 &&
    !Number.isNaN(thresholdValue) &&
    thresholdValue >= 0 &&
    (unitCostValue === null || (!Number.isNaN(unitCostValue) && unitCostValue >= 0)) &&
    unitsValid &&
    !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const payload = {
      restaurant_id: restaurantId,
      name: name.trim(),
      sku: sku.trim(),
      unit: unit.trim(),
      quantity_in_stock: stockValue,
      threshold_quantity: thresholdValue,
      unit_cost: unitCostValue,
      supplier_info: supplierInfo.trim() || null,
    };

    const { data: savedIngredient, error: saveError } = ingredient
      ? await supabase.from('ingredients').update(payload).eq('id', ingredient.id).select().single()
      : await supabase.from('ingredients').insert(payload).select().single();
    if (saveError || !savedIngredient) {
      setSaving(false);
      setError(saveError?.message ?? t('genericError'));
      return;
    }

    // Alternate units: update existing rows in place (their id may be
    // referenced by a recipe's unit_id), insert new ones, and delete only
    // rows the user actually removed — not a blanket replace, see the
    // originalUnitIds comment above.
    const keptIds = new Set(validUnitRows.filter((u) => u.id).map((u) => u.id!));
    const idsToDelete = [...originalUnitIds].filter((id) => !keptIds.has(id));
    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase.from('ingredient_units').delete().in('id', idsToDelete);
      if (deleteError) {
        setSaving(false);
        setError(deleteError.message);
        return;
      }
    }
    for (let i = 0; i < validUnitRows.length; i++) {
      const u = validUnitRows[i]!;
      const { error: unitError } = u.id
        ? await supabase
            .from('ingredient_units')
            .update({ name: u.name.trim(), conversion_to_stock_unit: Number(u.conversion), sort_order: i })
            .eq('id', u.id)
        : await supabase
            .from('ingredient_units')
            .insert({ ingredient_id: savedIngredient.id, name: u.name.trim(), conversion_to_stock_unit: Number(u.conversion), sort_order: i });
      if (unitError) {
        setSaving(false);
        setError(unitError.message);
        return;
      }
    }

    setSaving(false);
    onDone();
  }

  return (
    <div className="mt-2 rounded border border-border bg-surface p-3">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel text={t('ingredientNameLabel')} hint={t('ingredientNameHint')} />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('ingredientNamePlaceholder')}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <FieldLabel text={t('ingredientSkuLabel')} hint={t('ingredientSkuHint')} />
          <input
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder={t('ingredientSkuPlaceholder')}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-2">
        <div>
          <FieldLabel text={t('ingredientUnitLabel')} hint={t('ingredientUnitHint')} />
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder={t('ingredientUnitPlaceholder')}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <FieldLabel text={t('ingredientStockLabel')} hint={t('ingredientStockHint')} />
          <input
            type="number"
            min="0"
            step="0.01"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder={t('ingredientStockPlaceholder')}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <FieldLabel text={t('ingredientThresholdLabel')} hint={t('ingredientThresholdHint')} />
          <input
            type="number"
            min="0"
            step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={t('ingredientThresholdPlaceholder')}
            className="w-full rounded border border-border px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="mb-3">
        <p className="mb-1 flex items-start gap-1 text-xs font-medium text-ink">{t('ingredientUnitsLabel')}</p>
        <p className="mb-2 flex items-start gap-1 text-[11px] text-muted-foreground">
          <InfoIcon className="mt-0.5 h-3 w-3 shrink-0 text-sky-600" />
          <span>{t('ingredientUnitsHint')}</span>
        </p>
        {units.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {units.map((row, index) => (
              <div key={row.id ?? `new-${index}`} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateUnitRow(index, { name: e.target.value })}
                  placeholder={t('ingredientUnitNamePlaceholder')}
                  className="w-28 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
                />
                <span className="shrink-0 text-xs text-muted-foreground">=</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={row.conversion}
                  onChange={(e) => updateUnitRow(index, { conversion: e.target.value })}
                  placeholder={t('ingredientUnitConversionPlaceholder')}
                  className="w-24 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{unit || t('ingredientUnitLabel')}</span>
                <Tooltip content={t('ingredientUnitRemove')}>
                  <button
                    type="button"
                    onClick={() => removeUnitRow(index)}
                    aria-label={t('ingredientUnitRemove')}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addUnitRow}
          className="rounded border border-dashed border-border-strong px-2 py-1 text-xs text-accent hover:bg-accent-soft"
        >
          {t('ingredientUnitAdd')}
        </button>
      </div>
      <div className="mb-2">
        <FieldLabel text={t('ingredientUnitCostLabel')} hint={t('ingredientUnitCostHint')} />
        <input
          type="number"
          min="0"
          step="0.01"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          placeholder={t('ingredientUnitCostPlaceholder')}
          className="w-full rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <div className="mb-3">
        <FieldLabel text={t('ingredientSupplierLabel')} hint={t('ingredientSupplierHint')} />
        <input
          type="text"
          value={supplierInfo}
          onChange={(e) => setSupplierInfo(e.target.value)}
          placeholder={t('ingredientSupplierPlaceholder')}
          className="w-full rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {saving ? t('saving') : t('saveIngredient')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
