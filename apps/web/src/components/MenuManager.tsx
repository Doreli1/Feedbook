import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { supabase } from '../lib/supabase';
import type {
  Dish,
  DishModifierGroup,
  DishModifierOption,
  DishSizeOption,
  Ingredient,
  IngredientUnit,
  MenuCategory,
  ModifierOptionIngredient,
  ModifierOptionServingVariant,
} from '@feedbook/types';
import { TrashIcon, PencilIcon, SparklesIcon, InfoIcon, CloseIcon } from './Icons';
import { Tooltip } from './Tooltip';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { ingredientStockStatus } from '../lib/ingredientStatus';

// Categories + dishes CRUD, extracted out of the registration wizard's
// MenuBuilderForm so the exact same working implementation can also render
// inside the post-approval Dashboard (MenuScreen) — no wizard-chrome
// assumptions here, callers own the surrounding layout.

// dishes.description has a matching char_length <= 400 DB constraint
// (dish_description_length migration) — keep the two in sync.
const MAX_DESCRIPTION_LENGTH = 400;

// Shared by both ingredient-linking pickers below (dish-level, in DishForm,
// and per-addon-option, in ModifierOptionRowEditor) — found 2026-09-23: a
// recipe could be saved with a required quantity wildly exceeding the
// ingredient's own stock (e.g. 80kg of rice on-hand when only 6kg exists),
// with zero validation catching it. Converts the typed quantity to the
// ingredient's own stock unit (via the selected alternate unit's
// conversion_to_stock_unit, same math as deduct_inventory_for_order/
// restock_inventory_for_order_item on the server) so the comparison is
// always apples-to-apples regardless of which unit the recipe is written in.
function requiredQuantityInStockUnit(quantity: number, unitId: string, units: IngredientUnit[]): number {
  if (!unitId) return quantity;
  const unit = units.find((u) => u.id === unitId);
  return quantity * (unit?.conversion_to_stock_unit ?? 1);
}

function ingredientQuantityErrorKey(ingredient: Ingredient, requiredInStockUnit: number): TranslationKey | null {
  if (requiredInStockUnit > ingredient.quantity_in_stock) return 'dishIngredientExceedsStockError';
  if (requiredInStockUnit > ingredient.threshold_quantity) return 'dishIngredientExceedsThresholdError';
  return null;
}

// requiredQuantityInStockUnit's multiplication can leave floating-point
// noise (e.g. 0.1 * 3 = 0.30000000000000004) — rounding to 3 decimals keeps
// the consolidated tag list's "(הפחתה ממלאי: …)" readable.
function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 1000) / 1000);
}

interface MenuManagerProps {
  restaurantId: string;
  categories: MenuCategory[];
  dishes: Dish[];
  dishSizeOptions: DishSizeOption[];
  ingredients: Ingredient[];
  onRefresh: () => void;
  // Reports whether there's a typed-but-not-yet-submitted category name —
  // lets a wizard-mode caller warn before navigating away and silently
  // discarding it. Only the top-level "new category" draft is tracked (not
  // in-progress dish edits nested inside CategoryCard/DishForm below) — a
  // real but partial signal, not full coverage of every possible draft here.
  onDraftChange?: (hasDraft: boolean) => void;
}

export function MenuManager({ restaurantId, categories, dishes, dishSizeOptions, ingredients, onRefresh, onDraftChange }: MenuManagerProps) {
  const { t } = useI18n();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySection, setNewCategorySection] = useState<'food' | 'drink'>('food');
  const [addingCategory, setAddingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDraftChange?.(newCategoryName.trim() !== '');
    // onDraftChange is a plain setter passed fresh each render by the caller —
    // including it would re-fire this on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCategoryName]);

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setAddingCategory(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('menu_categories')
      .insert({ restaurant_id: restaurantId, name, sort_order: categories.length, section: newCategorySection });
    setAddingCategory(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewCategoryName('');
    setNewCategorySection('food');
    onRefresh();
  }

  async function handleDeleteCategory(categoryId: string) {
    setError(null);
    const { error: deleteError } = await supabase.from('menu_categories').delete().eq('id', categoryId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    onRefresh();
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-6 space-y-4">
        {categories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            dishes={dishes.filter((d) => d.category_id === category.id)}
            dishSizeOptions={dishSizeOptions}
            ingredients={ingredients}
            onRefresh={onRefresh}
            onDeleteCategory={() => void handleDeleteCategory(category.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder={t('categoryNamePlaceholder')}
          className="min-w-0 flex-1 rounded border border-border px-3 py-2 text-sm"
        />
        <SectionToggle value={newCategorySection} onChange={setNewCategorySection} />
        <button
          type="button"
          onClick={() => void handleAddCategory()}
          disabled={!newCategoryName.trim() || addingCategory}
          className="shrink-0 rounded bg-accent-soft px-4 py-2 text-sm font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50"
        >
          {t('addCategory')}
        </button>
      </div>
    </div>
  );
}

// Segmented food/drink toggle — the two-button pattern is the simplest UI
// for a two-valued enum (menu_categories.section), no dropdown/select
// needed. Used both when creating a new category and to reclassify an
// existing one, since every category defaulted to 'food' in the DB before
// this control existed and staff need a way to fix that retroactively, not
// just set it correctly going forward.
function SectionToggle({ value, onChange }: { value: 'food' | 'drink'; onChange: (v: 'food' | 'drink') => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex shrink-0 rounded border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange('food')}
        className={`rounded px-2.5 py-1 font-medium transition-colors ${value === 'food' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
      >
        {t('categorySectionFood')}
      </button>
      <button
        type="button"
        onClick={() => onChange('drink')}
        className={`rounded px-2.5 py-1 font-medium transition-colors ${value === 'drink' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
      >
        {t('categorySectionDrink')}
      </button>
    </div>
  );
}

// An iOS-style on/off switch (chosen by the user, replacing a plain
// checkbox) for gating an optional dish-form section behind one visible
// control: off by default, and only reveals the section's own editor once
// switched on. The knob's position is driven by `margin-inline-start`
// rather than a `translateX` transform — that's the one CSS property here
// that both animates smoothly AND is direction-aware on its own, so the
// same code slides the knob the physically-correct way in both RTL and LTR
// without reading `dir` explicitly (a `translateX` sign would need to flip
// per direction by hand, the exact class of bug documented for this app's
// RTL back-icon fix).
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span
        className="h-4 w-4 rounded-full bg-white shadow transition-[margin-inline-start] duration-150"
        style={{ marginInlineStart: checked ? '1.125rem' : '0.125rem' }}
      />
    </button>
  );
}

function CategoryCard({
  category,
  dishes,
  dishSizeOptions,
  ingredients,
  onRefresh,
  onDeleteCategory,
}: {
  category: MenuCategory;
  dishes: Dish[];
  dishSizeOptions: DishSizeOption[];
  ingredients: Ingredient[];
  onRefresh: () => void;
  onDeleteCategory: () => void;
}) {
  const { t } = useI18n();
  const [addingDish, setAddingDish] = useState(false);
  const [editingDishId, setEditingDishId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(category.name);

  async function commitRename() {
    const name = renameValue.trim();
    setRenaming(false);
    if (!name || name === category.name) {
      setRenameValue(category.name);
      return;
    }
    await supabase.from('menu_categories').update({ name }).eq('id', category.id);
    onRefresh();
  }

  async function changeSection(section: 'food' | 'drink') {
    if (section === category.section) return;
    await supabase.from('menu_categories').update({ section }).eq('id', category.id);
    onRefresh();
  }

  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SectionToggle value={category.section === 'drink' ? 'drink' : 'food'} onChange={(v) => void changeSection(v)} />
        {renaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setRenameValue(category.name);
                setRenaming(false);
              }
            }}
            autoFocus
            className="font-heading flex-1 rounded border border-accent px-2 py-1 text-sm font-semibold text-ink"
          />
        ) : (
          <h2 className="font-heading flex-1 text-sm font-semibold text-ink">{category.name}</h2>
        )}
        <Tooltip content={t('editCategory')}>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label={t('editCategory')}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
          >
            <PencilIcon />
          </button>
        </Tooltip>
        <Tooltip content={t('deleteCategory')}>
          <button
            type="button"
            onClick={onDeleteCategory}
            aria-label={t('deleteCategory')}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon />
          </button>
        </Tooltip>
      </div>

      <div className="space-y-2">
        {dishes.map((dish) =>
          editingDishId === dish.id ? (
            <DishForm
              key={dish.id}
              dish={dish}
              categoryId={category.id}
              section={category.section}
              restaurantId={category.restaurant_id}
              ingredients={ingredients}
              existingSizeOptions={dishSizeOptions.filter((s) => s.dish_id === dish.id)}
              onDone={() => {
                setEditingDishId(null);
                onRefresh();
              }}
              onCancel={() => setEditingDishId(null)}
            />
          ) : (
            <DishRow
              key={dish.id}
              dish={dish}
              section={category.section}
              sizeOptions={dishSizeOptions.filter((s) => s.dish_id === dish.id)}
              onRefresh={onRefresh}
              onEdit={() => setEditingDishId(dish.id)}
            />
          ),
        )}
      </div>

      {addingDish ? (
        <DishForm
          categoryId={category.id}
          section={category.section}
          restaurantId={category.restaurant_id}
          ingredients={ingredients}
          existingSizeOptions={[]}
          onDone={() => {
            setAddingDish(false);
            onRefresh();
          }}
          onCancel={() => setAddingDish(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingDish(true)}
          className="mt-2 w-full rounded border border-dashed border-border-strong py-1.5 text-xs text-accent hover:bg-accent-soft"
        >
          {t(category.section === 'drink' ? 'addDishDrink' : 'addDish')}
        </button>
      )}
    </div>
  );
}

function DishRow({
  dish,
  section,
  sizeOptions,
  onRefresh,
  onEdit,
}: {
  dish: Dish;
  section: string;
  sizeOptions: DishSizeOption[];
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const isDrink = section === 'drink';

  async function handleDelete() {
    await supabase.from('dishes').delete().eq('id', dish.id);
    onRefresh();
  }

  // Mirrors the mobile app's own priceLabel() exactly (MenuBrowser.tsx) —
  // once a dish has size options, its flat `price` column stops being what
  // a diner actually pays, so admin's own list view shouldn't show it as if
  // it still were.
  // Cheapest size specifically (not just its price) — needed to check that
  // exact size's own discount_fixed_price override (2026-10-01).
  const cheapestSize = sizeOptions.length > 0 ? sizeOptions.reduce((min, s) => (s.price < min.price ? s : min), sizeOptions[0]!) : null;
  const basePrice = cheapestSize ? cheapestSize.price : dish.price;
  const pricePrefix = sizeOptions.length > 0 ? `${t('dishPriceFrom')} ` : '';
  // Mirrors the mobile app's own PriceRow exactly (MenuBrowser.tsx,
  // 2026-10-01): three discount sources in priority order — a size's own
  // fixed-price override (only meaningful when the dish has sizes), the
  // dish-level 'fixed_price' mode (only meaningful when it doesn't), and the
  // dish-level percent (the uniform fallback either way). Always a whole
  // displayed price, and a discount percentage that's exact for a direct
  // percent but derived (and rounded up) when it comes from either kind of
  // fixed price.
  const hasDiscount = cheapestSize
    ? cheapestSize.discount_fixed_price != null || dish.discount_percent > 0
    : dish.discount_mode === 'fixed_price'
      ? dish.discount_fixed_price != null
      : dish.discount_percent > 0;
  const discountedPriceRaw = cheapestSize?.discount_fixed_price != null
    ? cheapestSize.discount_fixed_price
    : !cheapestSize && dish.discount_mode === 'fixed_price' && dish.discount_fixed_price != null
      ? dish.discount_fixed_price
      : basePrice * (1 - dish.discount_percent / 100);
  const discountedPrice = hasDiscount ? Math.round(discountedPriceRaw) : basePrice;
  // Exact for a direct percent, derived only when the source is a fixed
  // price — NOT computed as (1 - discountedPriceRaw / basePrice) * 100
  // unconditionally: that division reintroduces floating-point drift even
  // for an exact configured percent (e.g. 45 * (1 - 15/100) then back
  // through (1 - 38.25/45) * 100 lands on 15.000000000000002, not 15),
  // which would wrongly show "16%" for an exact 15% discount.
  const isFixedPriceSource = (cheapestSize?.discount_fixed_price ?? null) != null || (!cheapestSize && dish.discount_mode === 'fixed_price');
  const discountPercentDisplay = hasDiscount ? Math.ceil(isFixedPriceSource ? (1 - discountedPriceRaw / basePrice) * 100 : dish.discount_percent) : 0;

  return (
    <div className="flex items-center gap-3 rounded bg-surface p-2">
      {dish.photo_urls[0] ? (
        <img src={dish.photo_urls[0]} alt={dish.name} className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded bg-surface-2" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-ink">{dish.name}</p>
          {dish.feedstars_eligible && (
            // "Genius"-style badge (per the design comparison the user chose,
            // option A): solid rounded rectangle, gold background matching
            // the app's own star-rating color, white Baloo 2 wordmark, and
            // the same sparkles-outline icon the mobile app's Feedstars
            // badge uses — icon comes BEFORE the text in source order so it
            // lands on the text's physical right under this page's RTL flow.
            <span className="inline-flex shrink-0 items-center gap-[2px] rounded-md bg-[#F5A623] px-2 py-[3px] text-white">
              <SparklesIcon className="h-3 w-3 shrink-0" />
              <span className="font-brand text-[11px] font-bold leading-none">{t('dishFeedstarsBadge')}</span>
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{dish.description}</p>
      </div>
      <div className="shrink-0 text-end">
        {hasDiscount ? (
          <p className="tabular-nums text-sm font-medium text-ink">
            {pricePrefix}
            <span className="me-2 text-xs text-muted-foreground line-through">₪{basePrice}</span>
            <span className="text-danger">₪{discountedPrice}</span>
          </p>
        ) : (
          <p className="tabular-nums text-sm font-medium text-ink">
            {pricePrefix}₪{basePrice}
          </p>
        )}
        {hasDiscount && <p className="text-[10px] font-semibold text-danger">-{discountPercentDisplay}%</p>}
      </div>
      <Tooltip content={t(isDrink ? 'editDishDrink' : 'editDish')}>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t(isDrink ? 'editDishDrink' : 'editDish')}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={t(isDrink ? 'deleteDishDrink' : 'deleteDish')}>
        <button
          type="button"
          onClick={() => void handleDelete()}
          aria-label={t(isDrink ? 'deleteDishDrink' : 'deleteDish')}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

interface DishIngredientRow {
  ingredient_id: string;
  quantity_required: string;
  unit_id?: string;
  // Index into effectiveSizeOptions, not a real dish_size_options.id — a
  // brand-new size option row being created in this same save has no id yet.
  // undefined means "applies no matter which size is ordered" (also the only
  // possible value for a dish with no size options at all), matching
  // dish_ingredients.dish_size_option_id's own NULL-is-shared semantics
  // (found 2026-09-24: without this, ordering a bigger serving size deducted
  // the exact same ingredient quantities as the smaller one).
  sizeOptionIndex?: number;
  // Marks this specific ingredient link as "critical" for the dish (2026-09-24)
  // — surfaced to diners on mobile as a low-stock/out-of-stock warning on the
  // dish itself (see get_dish_critical_stock_status). Scoped to dish-level
  // ingredients only; an add-on's own ingredients have no equivalent flag.
  isCritical?: boolean;
}

// An already-uploaded photo (its public URL is all that's left to track) or
// one just picked from disk (not uploaded yet — kept as a File + a local
// blob: URL for instant preview, uploaded for real only on save). Index 0 in
// this list is always the dish's primary photo — the same convention every
// other screen already uses for `photo_urls[0]` (category cards, dish rows,
// the mobile menu) — so "make primary" is just "move to the front."
type PhotoSlot = { kind: 'existing'; url: string } | { kind: 'new'; file: File; previewUrl: string };

interface SizeOptionRow {
  id?: string;
  name: string;
  price: string;
  // Per-size fixed-price discount override (2026-10-01, per explicit
  // request) — empty = no override, falls back to the dish's own
  // discount_percent (which already applies uniformly across every size).
  // This is the "per size separately" answer to a dish like the smoked
  // entrecote (350g at ₪90, 700g at ₪130), where the dish-level fixed_price
  // mode can't apply — a single fixed price can't fit two different sizes.
  discountFixedPrice: string;
}

function buildInitialSizeOptions(existingSizeOptions: DishSizeOption[]): SizeOptionRow[] {
  return existingSizeOptions.map((s) => ({
    id: s.id,
    name: s.name,
    price: String(s.price),
    discountFixedPrice: s.discount_fixed_price != null ? String(s.discount_fixed_price) : '',
  }));
}

// dish_modifier_groups (built 2026-09-12 for mobile ordering, never had a
// Web Admin editor) is a generic name+selection_type+options mechanism —
// these two fixed, hardcoded group names are how this form recognizes "the
// add-ons group" and "the doneness group" for a given dish when reloading
// it for edit, rather than adding a dedicated "kind" column. A restaurant
// could in principle rename them by other means, but nothing here does
// that, so the identity holds in practice.
const ADDON_GROUP_NAME = 'תוספות למנה';
const DRINK_ADDON_GROUP_NAME = 'תוספות שתייה';
const DONENESS_GROUP_NAME = 'מידת עשייה';

interface ModifierOptionIngredientRow {
  ingredient_id: string;
  quantity_required: string;
  unit_id?: string;
  // Index into the same row's servingVariants array — undefined = this
  // requirement applies regardless of which format was chosen (or the option
  // has no variants at all), mirroring dishIngredients' sizeOptionIndex
  // convention exactly.
  servingVariantIndex?: number;
}

// A drink add-on's serving-format choice (2026-09-29) — bottle vs. draft
// (+ size), each its own price. Opt-in per option (servingVariantsEnabled on
// the owning ModifierOptionRow), not every drink add-on has this.
// containerType is the structured "which container" field (2026-09-29,
// follow-up) — name is just the size label within that container ("שליש",
// "חצי ליטר"), not a free-text description of the whole format anymore, so
// the mobile client can branch its picker on containerType directly instead
// of parsing a string.
interface ModifierOptionServingVariantRow {
  id?: string;
  containerType: 'bottle' | 'draft';
  name: string;
  price: string;
}

interface ModifierOptionRow {
  id?: string;
  name: string;
  price: string;
  photo: PhotoSlot | null;
  ingredients: ModifierOptionIngredientRow[];
  servingVariantsEnabled: boolean;
  servingVariants: ModifierOptionServingVariantRow[];
}

function buildInitialModifierOptions(
  options: (DishModifierOption & {
    modifier_option_ingredients: ModifierOptionIngredient[];
    modifier_option_serving_variants: ModifierOptionServingVariant[];
  })[],
): ModifierOptionRow[] {
  return options.map((o) => {
    const variants = (o.modifier_option_serving_variants ?? [])
      .filter((v) => v.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);
    return {
      id: o.id,
      name: o.name,
      price: o.price_delta > 0 ? String(o.price_delta) : '',
      photo: o.photo_url ? { kind: 'existing', url: o.photo_url } : null,
      servingVariantsEnabled: variants.length > 0,
      servingVariants: variants.map((v) => ({
        id: v.id,
        containerType: v.container_type === 'draft' ? 'draft' : 'bottle',
        name: v.name,
        price: v.price_delta > 0 ? String(v.price_delta) : '',
      })),
      ingredients: o.modifier_option_ingredients.map((i) => {
        const variantIndex = i.serving_variant_id ? variants.findIndex((v) => v.id === i.serving_variant_id) : -1;
        return {
          ingredient_id: i.ingredient_id,
          quantity_required: String(i.quantity_required),
          unit_id: i.unit_id ?? undefined,
          servingVariantIndex: variantIndex === -1 ? undefined : variantIndex,
        };
      }),
    };
  });
}

// Restaurant-configurable per-addon-group choice mode (2026-09-24) — same
// bordered-pill segmented-control look as SectionToggle above, reused here
// rather than introducing a second visual pattern for the same "pick one of
// two mutually exclusive options" shape.
function AddonSelectionTypeToggle({ value, onChange }: { value: 'single' | 'multiple'; onChange: (v: 'single' | 'multiple') => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">{t('dishAddonSelectionModeLabel')}</span>
      <div className="inline-flex shrink-0 rounded border border-border p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onChange('single')}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${value === 'single' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
        >
          {t('dishAddonSelectionSingle')}
        </button>
        <button
          type="button"
          onClick={() => onChange('multiple')}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${value === 'multiple' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
        >
          {t('dishAddonSelectionMultiple')}
        </button>
      </div>
    </div>
  );
}

// One toggle-gated section shared by both "תוספות למנה" (add-ons, priced)
// and "מידות עשייה" (doneness levels, unpriced) — same shape as the
// pre-existing "אפשרויות הגשה" section (heading + Toggle + hint-with-"!" +
// row list + add button), just parameterized on whether a price field
// renders per row, since that's the one real difference between the two.
function ModifierSection({
  enabled,
  onToggle,
  label,
  hint,
  namePlaceholder,
  pricePlaceholder,
  addLabel,
  removeLabel,
  includePrice,
  ingredients,
  ingredientUnitsMap,
  rows,
  onAdd,
  onUpdate,
  onRemove,
  onPhotoChange,
  onAddIngredient,
  extraHeaderContent,
  errorContent,
  enableServingVariants,
  onToggleServingVariants,
  onAddServingVariant,
  onUpdateServingVariant,
  onRemoveServingVariant,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  hint: string;
  namePlaceholder: string;
  pricePlaceholder?: string;
  addLabel: string;
  removeLabel: string;
  includePrice: boolean;
  ingredients?: Ingredient[];
  ingredientUnitsMap?: Map<string, IngredientUnit[]>;
  rows: ModifierOptionRow[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<ModifierOptionRow>) => void;
  onRemove: (index: number) => void;
  onPhotoChange: (index: number, file: File | null) => void;
  onAddIngredient?: (index: number, ingredientId: string, quantity: string, unitId: string, servingVariantIndex?: number) => void;
  // Rendered right after the hint — only the add-ons call site uses this
  // today (the single/multiple-choice segmented control), doneness passes
  // nothing and is unaffected.
  extraHeaderContent?: ReactNode;
  // Rendered right above the add button — validation feedback that belongs
  // to this section's own rows (e.g. an add-on missing its ingredient
  // link), kept next to the button a restaurant would use to fix it rather
  // than floating below the whole section.
  errorContent?: ReactNode;
  // Bottle/draft(+size) serving-format choice (2026-09-29) — only the drink
  // add-ons call site passes these.
  enableServingVariants?: boolean;
  onToggleServingVariants?: (index: number, enabled: boolean) => void;
  onAddServingVariant?: (index: number, containerType: 'bottle' | 'draft') => void;
  onUpdateServingVariant?: (index: number, variantIndex: number, patch: Partial<ModifierOptionServingVariantRow>) => void;
  onRemoveServingVariant?: (index: number, variantIndex: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-base font-bold text-ink">{label}</p>
        <Toggle checked={enabled} onChange={onToggle} label={label} />
      </div>
      {enabled && (
        <>
          <p className="mb-2 flex items-start gap-1 text-[11px] text-muted-foreground">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
            <span>{hint}</span>
          </p>
          {extraHeaderContent}
          {rows.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {rows.map((row, index) => (
                <ModifierOptionRowEditor
                  key={index}
                  row={row}
                  namePlaceholder={namePlaceholder}
                  pricePlaceholder={pricePlaceholder}
                  includePrice={includePrice}
                  ingredients={ingredients}
                  ingredientUnitsMap={ingredientUnitsMap}
                  removeLabel={removeLabel}
                  onUpdate={(patch) => onUpdate(index, patch)}
                  onRemove={() => onRemove(index)}
                  onPhotoChange={(file) => onPhotoChange(index, file)}
                  onAddIngredient={
                    onAddIngredient
                      ? (ingredientId, quantity, unitId, servingVariantIndex) => onAddIngredient(index, ingredientId, quantity, unitId, servingVariantIndex)
                      : undefined
                  }
                  enableServingVariants={enableServingVariants}
                  onToggleServingVariants={onToggleServingVariants ? (v) => onToggleServingVariants(index, v) : undefined}
                  onAddServingVariant={onAddServingVariant ? (containerType) => onAddServingVariant(index, containerType) : undefined}
                  onUpdateServingVariant={onUpdateServingVariant ? (variantIndex, patch) => onUpdateServingVariant(index, variantIndex, patch) : undefined}
                  onRemoveServingVariant={onRemoveServingVariant ? (variantIndex) => onRemoveServingVariant(index, variantIndex) : undefined}
                />
              ))}
            </div>
          )}
          {ingredients && ingredients.length > 0 && rows.length > 0 && (
            <p className="mb-2 flex items-start gap-1 text-[11px] text-muted-foreground">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span>{t('dishAddonIngredientsHint')}</span>
            </p>
          )}
          {errorContent}
          <button
            type="button"
            onClick={onAdd}
            className="rounded border border-dashed border-border-strong px-2 py-1 text-xs text-accent hover:bg-accent-soft"
          >
            {addLabel}
          </button>
        </>
      )}
    </div>
  );
}

// Isolated per-row so each row's own file input ref (and its own
// ingredient-picker draft state) is independent.
function ModifierOptionRowEditor({
  row,
  namePlaceholder,
  pricePlaceholder,
  includePrice,
  ingredients,
  ingredientUnitsMap,
  removeLabel,
  onUpdate,
  onRemove,
  onPhotoChange,
  onAddIngredient,
  enableServingVariants,
  onToggleServingVariants,
  onAddServingVariant,
  onUpdateServingVariant,
  onRemoveServingVariant,
}: {
  row: ModifierOptionRow;
  namePlaceholder: string;
  pricePlaceholder?: string;
  includePrice: boolean;
  ingredients?: Ingredient[];
  ingredientUnitsMap?: Map<string, IngredientUnit[]>;
  removeLabel: string;
  onUpdate: (patch: Partial<ModifierOptionRow>) => void;
  onRemove: () => void;
  onPhotoChange: (file: File | null) => void;
  onAddIngredient?: (ingredientId: string, quantity: string, unitId: string, servingVariantIndex?: number) => void;
  // Bottle/draft(+size) serving-format choice (2026-09-29) — only the drink
  // add-ons call site passes these; regular add-ons and doneness never do.
  enableServingVariants?: boolean;
  onToggleServingVariants?: (enabled: boolean) => void;
  onAddServingVariant?: (containerType: 'bottle' | 'draft') => void;
  onUpdateServingVariant?: (variantIndex: number, patch: Partial<ModifierOptionServingVariantRow>) => void;
  onRemoveServingVariant?: (variantIndex: number) => void;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoUrl = row.photo?.kind === 'existing' ? row.photo.url : row.photo?.kind === 'new' ? row.photo.previewUrl : null;
  const [pickIngredientId, setPickIngredientId] = useState('');
  const [pickQuantity, setPickQuantity] = useState('');
  const [pickUnitId, setPickUnitId] = useState('');
  const [pickError, setPickError] = useState<TranslationKey | null>(null);
  // '' = applies regardless of which format was ordered — only ever shown/
  // settable when this option actually has serving variants defined.
  const [pickServingVariantIndex, setPickServingVariantIndex] = useState('');
  const pickedIngredient = ingredients?.find((i) => i.id === pickIngredientId);

  function addIngredient() {
    const qty = Number(pickQuantity);
    if (!pickIngredientId || !pickQuantity.trim() || Number.isNaN(qty) || qty <= 0 || !onAddIngredient) return;
    if (pickedIngredient) {
      const requiredInStockUnit = requiredQuantityInStockUnit(qty, pickUnitId, ingredientUnitsMap?.get(pickIngredientId) ?? []);
      const errorKey = ingredientQuantityErrorKey(pickedIngredient, requiredInStockUnit);
      if (errorKey) {
        setPickError(errorKey);
        return;
      }
    }
    setPickError(null);
    onAddIngredient(pickIngredientId, pickQuantity, pickUnitId, pickServingVariantIndex === '' ? undefined : Number(pickServingVariantIndex));
    setPickIngredientId('');
    setPickQuantity('');
    setPickUnitId('');
    setPickServingVariantIndex('');
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip content={photoUrl ? t('dishOptionPhotoRemove') : t('dishOptionPhotoAdd')}>
          <button
            type="button"
            onClick={() => (photoUrl ? onPhotoChange(null) : fileInputRef.current?.click())}
            aria-label={photoUrl ? t('dishOptionPhotoRemove') : t('dishOptionPhotoAdd')}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-dashed border-border-strong text-muted-foreground hover:border-accent hover:text-accent"
          >
            {photoUrl ? <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="text-sm leading-none">+</span>}
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            onPhotoChange(e.target.files?.[0] ?? null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <input
          type="text"
          value={row.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder={namePlaceholder}
          className="w-32 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
        />
        {includePrice && (
          <div className="relative w-32 shrink-0">
            <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-xs text-muted-foreground">₪</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={row.price}
              onChange={(e) => onUpdate({ price: e.target.value })}
              placeholder={pricePlaceholder}
              className="w-full rounded border border-border py-1.5 ps-5 pe-1 text-xs"
            />
          </div>
        )}
        {ingredients && ingredients.length > 0 && (
          <>
            <select
              value={pickIngredientId}
              onChange={(e) => {
                setPickIngredientId(e.target.value);
                setPickUnitId('');
                setPickError(null);
              }}
              className="w-32 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
            >
              <option value="">{t('dishIngredientPickPlaceholder')}</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={pickQuantity}
              onChange={(e) => {
                setPickQuantity(e.target.value);
                setPickError(null);
              }}
              placeholder={t('dishIngredientQuantityPlaceholder')}
              className="w-32 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
            />
            <select
              value={pickUnitId}
              onChange={(e) => {
                setPickUnitId(e.target.value);
                setPickError(null);
              }}
              className="w-32 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
            >
              <option value="">{ingredients.find((i) => i.id === pickIngredientId)?.unit ?? t('dishIngredientUnitPlaceholder')}</option>
              {(ingredientUnitsMap?.get(pickIngredientId) ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {row.servingVariantsEnabled && row.servingVariants.length > 0 && (
              <select
                value={pickServingVariantIndex}
                onChange={(e) => setPickServingVariantIndex(e.target.value)}
                className="w-32 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
              >
                <option value="">{t('dishServingVariantAllOption')}</option>
                {row.servingVariants.map((v, vi) => (
                  <option key={vi} value={vi}>
                    {t(v.containerType === 'bottle' ? 'dishServingVariantBottleLabel' : 'dishServingVariantDraftLabel')} - {v.name.trim() || t('dishServingVariantNamePlaceholder')}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={addIngredient}
              className="shrink-0 rounded bg-accent-soft px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white"
            >
              {t('addIngredientToDish')}
            </button>
          </>
        )}
        <Tooltip content={removeLabel}>
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      {!photoUrl && row.name.trim() !== '' && (
        // Soft warning only (2026-09-23) — not a save-blocking requirement.
        // Flagged as a topic for deeper review in the Implementation Plan
        // (a `requires_photo` flag + DB-level enforcement was the harder
        // alternative discussed and deferred): every option row here
        // belongs to one of exactly three groups (ADDON_GROUP_NAME /
        // DRINK_ADDON_GROUP_NAME / DONENESS_GROUP_NAME — see ModifierSection's
        // three call sites), all of which are visually distinguishing choices
        // for the diner (rice vs. fries, coke vs. water, medium vs.
        // well-done), so this can fire unconditionally whenever a named
        // option has no photo, with no extra flag needed.
        <p className="ms-9 mt-1 flex items-start gap-1 text-[11px] text-warning">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>{t('dishOptionPhotoMissingWarning')}</span>
        </p>
      )}
      {pickError && pickedIngredient && (
        <p className="ms-9 mt-1 flex items-start gap-1 text-[11px] text-danger">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <span>
            {t(pickError)
              .replace('{required}', String(requiredQuantityInStockUnit(Number(pickQuantity), pickUnitId, ingredientUnitsMap?.get(pickIngredientId) ?? [])))
              .replaceAll('{unit}', pickedIngredient.unit)
              .replace('{stock}', String(pickedIngredient.quantity_in_stock))
              .replace('{threshold}', String(pickedIngredient.threshold_quantity))}
          </span>
        </p>
      )}
      {enableServingVariants && (
        <div className="ms-9 mt-2 rounded border border-border bg-gray-100 p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-ink">{t('dishServingVariantsToggleLabel')}</span>
            <Toggle checked={row.servingVariantsEnabled} onChange={(v) => onToggleServingVariants?.(v)} label={t('dishServingVariantsToggleLabel')} />
          </div>
          {row.servingVariantsEnabled && (
            <div className="space-y-3">
              <ServingVariantContainerList
                containerType="bottle"
                label={t('dishServingVariantBottleLabel')}
                variants={row.servingVariants}
                onUpdate={(vi, patch) => onUpdateServingVariant?.(vi, patch)}
                onRemove={(vi) => onRemoveServingVariant?.(vi)}
                onAdd={() => onAddServingVariant?.('bottle')}
              />
              <ServingVariantContainerList
                containerType="draft"
                label={t('dishServingVariantDraftLabel')}
                variants={row.servingVariants}
                onUpdate={(vi, patch) => onUpdateServingVariant?.(vi, patch)}
                onRemove={(vi) => onRemoveServingVariant?.(vi)}
                onAdd={() => onAddServingVariant?.('draft')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// One container type's (בקבוק or חבית) size+price rows, filtered out of the
// option's own flat servingVariants array (2026-09-29, follow-up) — kept as
// one flat array with a containerType discriminator rather than two
// separate arrays, so removing/re-indexing stays a single well-tested code
// path (removeServingVariantRow), while the admin still sees two clearly
// separate lists. Real position in the flat array is threaded through
// (not the filtered list's own index) since that's what every callback
// (update/remove/the ingredient picker's servingVariantIndex) actually
// keys on.
function ServingVariantContainerList({
  containerType,
  label,
  variants,
  onUpdate,
  onRemove,
  onAdd,
}: {
  containerType: 'bottle' | 'draft';
  label: string;
  variants: ModifierOptionServingVariantRow[];
  onUpdate: (variantIndex: number, patch: Partial<ModifierOptionServingVariantRow>) => void;
  onRemove: (variantIndex: number) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const rows = variants.map((v, vi) => ({ v, vi })).filter(({ v }) => v.containerType === containerType);
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-ink">{label}</p>
      {rows.length > 0 && (
        <div className="mb-1.5 space-y-1">
          {rows.map(({ v, vi }) => (
            <div key={vi} className="flex items-center gap-1.5">
              <input
                type="text"
                value={v.name}
                onChange={(e) => onUpdate(vi, { name: e.target.value })}
                placeholder={t('dishServingVariantNamePlaceholder')}
                className="w-32 shrink-0 rounded border border-border px-2 py-1 text-[11px]"
              />
              <div className="relative w-32 shrink-0">
                <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-[11px] text-muted-foreground">₪</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={v.price}
                  onChange={(e) => onUpdate(vi, { price: e.target.value })}
                  placeholder={t('dishServingVariantPricePlaceholder')}
                  className="w-full rounded border border-border py-1 ps-5 pe-1 text-[11px]"
                />
              </div>
              <Tooltip content={t('dishServingVariantRemove')}>
                <button
                  type="button"
                  onClick={() => onRemove(vi)}
                  aria-label={t('dishServingVariantRemove')}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={onAdd} className="rounded border border-dashed border-border-strong px-2 py-1 text-[11px] text-accent hover:bg-accent-soft">
        {t('dishServingVariantAdd')}
      </button>
    </div>
  );
}

function DishForm({
  dish,
  categoryId,
  section,
  restaurantId,
  ingredients,
  existingSizeOptions,
  onDone,
  onCancel,
}: {
  dish?: Dish;
  categoryId: string;
  section: string;
  restaurantId: string;
  ingredients: Ingredient[];
  existingSizeOptions: DishSizeOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const isDrink = section === 'drink';
  const [name, setName] = useState(dish?.name ?? '');
  const [price, setPrice] = useState(dish ? String(dish.price) : '');
  const [description, setDescription] = useState(dish?.description ?? '');
  const [feedstarsEligible, setFeedstarsEligible] = useState(dish?.feedstars_eligible ?? false);
  const [discountPercent, setDiscountPercent] = useState(dish && dish.discount_percent > 0 ? String(dish.discount_percent) : '');
  // Discount mechanism choice (2026-10-01, per explicit request): 'percent'
  // (existing flat-percentage-off) or 'fixed_price' — staff types the final
  // discounted price directly instead of a percentage. Only offered when the
  // dish has no size options (see fixedPriceModeAllowed below) — a single
  // fixed price can't sensibly apply to several differently-priced sizes the
  // way a flat percentage already does.
  const [discountMode, setDiscountMode] = useState<'percent' | 'fixed_price'>(dish?.discount_mode === 'fixed_price' ? 'fixed_price' : 'percent');
  const [discountFixedPrice, setDiscountFixedPrice] = useState(dish?.discount_fixed_price != null ? String(dish.discount_fixed_price) : '');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(dish && dish.prep_time_minutes ? String(dish.prep_time_minutes) : '');
  const [photos, setPhotos] = useState<PhotoSlot[]>(() => (dish?.photo_urls ?? []).map((url) => ({ kind: 'existing', url }) as PhotoSlot));
  const [sizeOptions, setSizeOptions] = useState<SizeOptionRow[]>(() => buildInitialSizeOptions(existingSizeOptions));
  // Off by default for a new dish; a dish that already has data for a
  // section (editing an existing one) starts with that section switched on
  // — the toggle is a pure show/hide affordance derived from what's already
  // there, not a separately stored flag, exactly like "no size options
  // rows" already meant "not used" before this toggle existed.
  const [servingOptionsEnabled, setServingOptionsEnabled] = useState(existingSizeOptions.length > 0);
  const [addonsEnabled, setAddonsEnabled] = useState(false);
  const [addonOptions, setAddonOptions] = useState<ModifierOptionRow[]>([]);
  const [addonGroupId, setAddonGroupId] = useState<string | undefined>(undefined);
  // Restaurant-configurable per the user's request 2026-09-24 — was
  // hardcoded 'multiple' before. Doneness stays hardcoded 'single' (that's
  // inherently a single choice, not something a restaurant should toggle).
  const [addonSelectionType, setAddonSelectionType] = useState<'single' | 'multiple'>('multiple');
  // Drink add-ons (2026-09-29) — an exact duplicate of the food add-ons
  // section above (same template, same ingredient-linking validation), just
  // its own separate dish_modifier_groups row (DRINK_ADDON_GROUP_NAME) so a
  // dish can offer both independently (e.g. "תוספות למנה" for a side, "תוספות
  // שתייה" for a drink pairing).
  const [drinkAddonsEnabled, setDrinkAddonsEnabled] = useState(false);
  const [drinkAddonOptions, setDrinkAddonOptions] = useState<ModifierOptionRow[]>([]);
  const [drinkAddonGroupId, setDrinkAddonGroupId] = useState<string | undefined>(undefined);
  const [drinkAddonSelectionType, setDrinkAddonSelectionType] = useState<'single' | 'multiple'>('multiple');
  const [donenessEnabled, setDonenessEnabled] = useState(false);
  const [donenessOptions, setDonenessOptions] = useState<ModifierOptionRow[]>([]);
  const [donenessGroupId, setDonenessGroupId] = useState<string | undefined>(undefined);
  // Snapshot of which option ids existed at load time, separate from the
  // live addonOptions/donenessOptions edit state — needed so saveModifierGroup
  // can reconcile by id (update/insert/delete-only-what-was-actually-removed)
  // instead of delete-the-whole-group-then-recreate-it. Found 2026-09-24: a
  // modifier option's id can be referenced by order_item_modifiers with no
  // ON DELETE clause (default restrict) once actually ordered, so the old
  // delete-everything approach started failing outright the moment any
  // option had ever been ordered — same bug class as dish_size_options
  // earlier this session, just not caught until the add-on
  // single/multiple-choice toggle exposed it (the save silently failed on
  // the FK violation, so the toggle never actually persisted).
  const [existingAddonOptionIds, setExistingAddonOptionIds] = useState<Set<string>>(new Set());
  const [existingDrinkAddonOptionIds, setExistingDrinkAddonOptionIds] = useState<Set<string>>(new Set());
  const [existingDonenessOptionIds, setExistingDonenessOptionIds] = useState<Set<string>>(new Set());
  const [existingServingVariantIdsByOptionId, setExistingServingVariantIdsByOptionId] = useState<Map<string, Set<string>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // The error banner renders at the very top of this form, but Save sits at
  // the bottom of a long scrollable section list (photos, sizes, addons,
  // ingredients...) — found 2026-09-24: a blocked save (e.g. size options
  // that can't be removed because real orders reference them,
  // dishSizeOptionInUseError) silently looked like nothing happened, because
  // the admin never scrolled back up far enough to see why it failed.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dishIngredients, setDishIngredients] = useState<DishIngredientRow[]>([]);
  // Ingredient ids marked critical when this form loaded (2026-09-29) — a
  // snapshot, not derived from the live dishIngredients state, so removing
  // one of them entirely (not just un-checking "קריטי") can be caught at
  // save time. Found via a real repro: a dish with 2 serving options and its
  // critical "בשר בקר" link removed saved successfully with no warning at
  // all — the critical-stock bullets/blocking this restaurant relies on
  // would silently stop working for that dish.
  const [existingCriticalIngredientIds, setExistingCriticalIngredientIds] = useState<Set<string>>(new Set());
  const [pickIngredientId, setPickIngredientId] = useState('');
  const [pickQuantity, setPickQuantity] = useState('');
  const [pickUnitId, setPickUnitId] = useState('');
  const [pickError, setPickError] = useState<TranslationKey | null>(null);
  // '' = shared across every size (or the only option for a dish with none) —
  // only ever shown/settable when there are 2+ size options to disambiguate.
  const [pickSizeOptionIndex, setPickSizeOptionIndex] = useState('');

  useEffect(() => {
    if (!dish) return;
    void supabase
      .from('dish_modifier_groups')
      .select('id, name, selection_type, dish_modifier_options(*, modifier_option_ingredients(*), modifier_option_serving_variants(*))')
      .eq('dish_id', dish.id)
      .then(({ data }) => {
        const groups = (data ?? []) as (DishModifierGroup & {
          dish_modifier_options: (DishModifierOption & {
            modifier_option_ingredients: ModifierOptionIngredient[];
            modifier_option_serving_variants: ModifierOptionServingVariant[];
          })[];
        })[];
        const addonGroup = groups.find((g) => g.name === ADDON_GROUP_NAME);
        const drinkAddonGroup = groups.find((g) => g.name === DRINK_ADDON_GROUP_NAME);
        const donenessGroup = groups.find((g) => g.name === DONENESS_GROUP_NAME);
        // Snapshot of which serving-variant ids existed at load time, across
        // every option in every group — used at save time to soft-delete
        // only what was actually removed (same reconciliation reason as
        // existingAddonOptionIds), never a delete-the-whole-set-then-
        // recreate replace, since order_item_modifiers.serving_variant_id can
        // reference one with no ON DELETE clause once actually ordered.
        const variantIdsByOption = new Map<string, Set<string>>();
        for (const group of groups) {
          for (const option of group.dish_modifier_options) {
            variantIdsByOption.set(option.id, new Set(option.modifier_option_serving_variants.filter((v) => v.is_active).map((v) => v.id)));
          }
        }
        setExistingServingVariantIdsByOptionId(variantIdsByOption);
        if (addonGroup) {
          setAddonGroupId(addonGroup.id);
          setAddonsEnabled(true);
          setAddonSelectionType(addonGroup.selection_type === 'single' ? 'single' : 'multiple');
          setAddonOptions(buildInitialModifierOptions(addonGroup.dish_modifier_options.sort((a, b) => a.sort_order - b.sort_order)));
          setExistingAddonOptionIds(new Set(addonGroup.dish_modifier_options.map((o) => o.id)));
        }
        if (drinkAddonGroup) {
          setDrinkAddonGroupId(drinkAddonGroup.id);
          setDrinkAddonsEnabled(true);
          setDrinkAddonSelectionType(drinkAddonGroup.selection_type === 'single' ? 'single' : 'multiple');
          setDrinkAddonOptions(buildInitialModifierOptions(drinkAddonGroup.dish_modifier_options.sort((a, b) => a.sort_order - b.sort_order)));
          setExistingDrinkAddonOptionIds(new Set(drinkAddonGroup.dish_modifier_options.map((o) => o.id)));
        }
        if (donenessGroup) {
          setDonenessGroupId(donenessGroup.id);
          setDonenessEnabled(true);
          setDonenessOptions(buildInitialModifierOptions(donenessGroup.dish_modifier_options.sort((a, b) => a.sort_order - b.sort_order)));
          setExistingDonenessOptionIds(new Set(donenessGroup.dish_modifier_options.map((o) => o.id)));
        }
      });
    // dish.id is stable for the lifetime of an edit session — same
    // once-on-mount rationale as the dish_ingredients fetch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dish) return;
    void supabase
      .from('dish_ingredients')
      .select('ingredient_id, quantity_required, unit_id, dish_size_option_id, is_critical')
      .eq('dish_id', dish.id)
      .then(({ data }) => {
        setExistingCriticalIngredientIds(new Set((data ?? []).filter((r) => r.is_critical).map((r) => r.ingredient_id)));
        setDishIngredients(
          (data ?? []).map((r) => {
            // Resolved against existingSizeOptions (the props snapshot from
            // when this form opened, not the live sizeOptions edit state) —
            // indices there still match what dish_size_option_id was
            // actually saved against. -1 (not found — the size option row
            // was deleted from under an in-flight fetch) falls back to
            // "applies to all sizes" rather than a nonsense index.
            const idx = r.dish_size_option_id ? existingSizeOptions.findIndex((s) => s.id === r.dish_size_option_id) : -1;
            return {
              ingredient_id: r.ingredient_id,
              quantity_required: String(r.quantity_required),
              unit_id: r.unit_id ?? undefined,
              sizeOptionIndex: idx === -1 ? undefined : idx,
              isCritical: r.is_critical,
            };
          }),
        );
      });
    // dish.id is stable for the lifetime of an edit session — this only
    // needs to run once when the form mounts for an existing dish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every ingredient's own alternate units (see ingredient_units), keyed by
  // ingredient id — fetched once for the whole restaurant's ingredient list
  // rather than per-picker, since both the dish's own ingredient picker and
  // each add-on's ingredient picker need the same data.
  const [ingredientUnitsMap, setIngredientUnitsMap] = useState<Map<string, IngredientUnit[]>>(new Map());
  useEffect(() => {
    if (ingredients.length === 0) return;
    void supabase
      .from('ingredient_units')
      .select('*')
      .in('ingredient_id', ingredients.map((i) => i.id))
      .order('sort_order')
      .then(({ data }) => {
        const map = new Map<string, IngredientUnit[]>();
        for (const u of (data ?? []) as IngredientUnit[]) {
          const list = map.get(u.ingredient_id) ?? [];
          list.push(u);
          map.set(u.ingredient_id, list);
        }
        setIngredientUnitsMap(map);
      });
    // The restaurant's ingredient list doesn't change while this form is
    // open — once on mount, matching every other local fetch in this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke every blob: preview URL when the form itself goes away (save,
  // cancel, or the parent unmounts it another way) — not on every `photos`
  // change, which would revoke previews still being displayed. The ref
  // tracks the latest value so the cleanup (registered once, on mount)
  // still sees whatever's actually in state at unmount time.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const addonOptionsRef = useRef(addonOptions);
  addonOptionsRef.current = addonOptions;
  const drinkAddonOptionsRef = useRef(drinkAddonOptions);
  drinkAddonOptionsRef.current = drinkAddonOptions;
  const donenessOptionsRef = useRef(donenessOptions);
  donenessOptionsRef.current = donenessOptions;
  useEffect(() => {
    return () => {
      for (const slot of photosRef.current) {
        if (slot.kind === 'new') URL.revokeObjectURL(slot.previewUrl);
      }
      for (const row of [...addonOptionsRef.current, ...drinkAddonOptionsRef.current, ...donenessOptionsRef.current]) {
        if (row.photo?.kind === 'new') URL.revokeObjectURL(row.photo.previewUrl);
      }
    };
  }, []);

  const effectiveSizeOptions = servingOptionsEnabled ? sizeOptions : [];
  const sizeOptionsValid =
    effectiveSizeOptions.length === 0 ||
    effectiveSizeOptions.every((s) => s.name.trim() !== '' && s.price.trim() !== '' && Number.isFinite(Number(s.price)) && Number(s.price) >= 0);
  // Per-size fixed-price discount override validation (2026-10-01) — same
  // range rule as the dish-level fixed_price field (discountFixedPriceValid
  // above), just per row and only when that row actually has a value typed.
  const sizeOptionsInvalidDiscountNames = effectiveSizeOptions
    .filter((s) => {
      if (s.discountFixedPrice.trim() === '') return false;
      const discountValueForSize = Number(s.discountFixedPrice);
      const priceValueForSize = Number(s.price);
      return !(Number.isFinite(discountValueForSize) && discountValueForSize > 0 && Number.isFinite(priceValueForSize) && discountValueForSize < priceValueForSize);
    })
    .map((s) => s.name.trim() || t('dishSizeOptionNamePlaceholder'));
  const sizeOptionsDiscountValid = sizeOptionsInvalidDiscountNames.length === 0;
  // dishes.price is a NOT NULL column that place_order_transaction only
  // falls back to when a dish has zero size options at all — once serving
  // options are on, the manual price field is redundant (and confusing:
  // two prices that could disagree) and per the user's request 2026-09-23
  // is dropped from the form entirely. No serving option is "default" any
  // more (2026-09-24, per the user's request — the diner app must never
  // pre-select one), so dishes.price instead syncs to the minimum size
  // price, mirroring the exact "from ₪X" figure the dish list/mobile browse
  // screens already independently compute and show (priceLabel/PriceRow in
  // MenuBrowser.tsx, and this file's own CategoryCard). The `0` fallback
  // only matters for the pre-existing edge case of serving options toggled
  // on with zero rows yet — better than silently sending NaN/Infinity into
  // a NOT NULL numeric column.
  const validSizePrices = effectiveSizeOptions.map((s) => Number(s.price)).filter((n) => Number.isFinite(n));
  const priceValue = servingOptionsEnabled ? (validSizePrices.length > 0 ? Math.min(...validSizePrices) : 0) : Number(price);
  const discountValue = discountPercent.trim() === '' ? 0 : Number(discountPercent);
  const discountValid = Number.isFinite(discountValue) && discountValue >= 0 && discountValue <= 100;
  // fixed_price mode requires the dish to have no size options at all (see
  // discountMode's own comment above) — a single fixed price can't apply to
  // several differently-priced sizes the way a flat percentage already does.
  const fixedPriceModeBlockedBySizes = discountMode === 'fixed_price' && effectiveSizeOptions.length > 0;
  const discountFixedPriceValue = discountFixedPrice.trim() === '' ? null : Number(discountFixedPrice);
  const discountFixedPriceValid =
    discountMode !== 'fixed_price' ||
    (!fixedPriceModeBlockedBySizes &&
      discountFixedPriceValue !== null &&
      Number.isFinite(discountFixedPriceValue) &&
      discountFixedPriceValue > 0 &&
      discountFixedPriceValue < priceValue);
  const prepTimeValue = prepTimeMinutes.trim() === '' ? null : Number(prepTimeMinutes);
  const prepTimeValid = prepTimeValue === null || (Number.isInteger(prepTimeValue) && prepTimeValue > 0);
  // Required + strictly > 0 (2026-09-29, per explicit request) — with
  // serving options off, this is the dish's only price; 0 or empty is never
  // a real, sellable value.
  const manualPriceValid = servingOptionsEnabled || (price.trim() !== '' && !Number.isNaN(priceValue) && priceValue > 0);
  // Ingredient linking on an add-on is no longer optional (2026-09-23) — an
  // add-on with no linked ingredient at all was a real gap in the JIT
  // inventory story (choosing it deducted nothing), so every named add-on
  // row must now link at least one. Doneness options are unaffected: that
  // ModifierSection never passes ingredients/onAddIngredient at all (it's a
  // cooking instruction, not a material), so this only ever gates addons.
  // This blocked save silently until 2026-09-29 — canSave went false with no
  // visible reason, so a forgotten link just looked like a broken Save
  // button. addonsMissingIngredientNames now names the exact row(s) still
  // missing a link, next to the addons section itself.
  const addonsMissingIngredientNames = addonsEnabled
    ? addonOptions.filter((r) => r.name.trim() !== '' && r.ingredients.length === 0).map((r) => r.name)
    : [];
  const addonsValid = addonsMissingIngredientNames.length === 0;
  // Drink add-ons (2026-09-29) — exact duplicate of the addons validation
  // above, same rule, its own separate group.
  const drinkAddonsMissingIngredientNames = drinkAddonsEnabled
    ? drinkAddonOptions.filter((r) => r.name.trim() !== '' && r.ingredients.length === 0).map((r) => r.name)
    : [];
  const drinkAddonsValid = drinkAddonsMissingIngredientNames.length === 0;
  // Real gap found (2026-09-29): adding a new serving-format row (e.g. a
  // "1/2 ליטר" bottle) saved successfully with no ingredient requirement
  // scoped to it at all — the option-level check above only asks "does THIS
  // OPTION have any ingredient link anywhere", which an unrelated variant's
  // link (or an "all variants" link on a different ingredient) already
  // satisfies, so a brand-new variant with zero coverage of its own slipped
  // through silently. Ordering it would deduct nothing from stock. A link
  // scoped to "all variants" (servingVariantIndex undefined) covers every
  // variant including this one, so it's checked first before flagging any
  // specific variant as uncovered.
  const drinkAddonsMissingVariantIngredientLabels: string[] = [];
  for (const row of drinkAddonOptions) {
    if (!row.servingVariantsEnabled || row.servingVariants.length === 0) continue;
    if (row.ingredients.some((r) => r.servingVariantIndex === undefined)) continue;
    row.servingVariants.forEach((v, vi) => {
      if (row.ingredients.some((r) => r.servingVariantIndex === vi)) return;
      const optionName = row.name.trim() || t('dishDrinkAddonNamePlaceholder');
      const containerLabel = t(v.containerType === 'bottle' ? 'dishServingVariantBottleLabel' : 'dishServingVariantDraftLabel');
      const sizeName = v.name.trim() || t('dishServingVariantNamePlaceholder');
      drinkAddonsMissingVariantIngredientLabels.push(`${optionName} (${containerLabel} - ${sizeName})`);
    });
  }
  const drinkAddonServingVariantsValid = drinkAddonsMissingVariantIngredientLabels.length === 0;

  // Turning serving sizes off collapses every row's dish_size_option_id to
  // null (see savedSizeOptionIds resolution in handleSave) — a real conflict
  // when the same ingredient has multiple size-specific rows (different
  // quantity per size), since they'd all collide on the same
  // (dish_id, ingredient_id, null) unique key. Found 2026-09-24 via a real
  // save attempt on a dish with per-size beef quantities that hit
  // dish_ingredients_dish_ingredient_size_idx directly instead of a friendly
  // validation message. Block save (not just warn) since the raw DB error
  // otherwise reaches the admin verbatim.
  const sizesDisabledDuplicateIngredientNames = servingOptionsEnabled
    ? []
    : Array.from(dishIngredients.reduce((map, r) => map.set(r.ingredient_id, (map.get(r.ingredient_id) ?? 0) + 1), new Map<string, number>()))
        .filter(([, count]) => count > 1)
        .map(([ingredientId]) => ingredients.find((i) => i.id === ingredientId)?.name ?? '?');

  // A critical ingredient link removed entirely (not just un-checked
  // "קריטי") — real repro 2026-09-29: a dish with 2 serving options and its
  // critical "בשר בקר" link removed saved successfully with zero warning,
  // silently disabling that dish's critical-stock bullets/blocking on
  // mobile. Compares against existingCriticalIngredientIds (the snapshot
  // from when the form loaded), not the live is_critical flags, so this
  // catches full removal specifically — merely un-marking "קריטי" on a kept
  // link is a deliberate, allowed choice, not this.
  const removedCriticalIngredientNames = Array.from(existingCriticalIngredientIds)
    .filter((ingredientId) => !dishIngredients.some((r) => r.ingredient_id === ingredientId))
    .map((ingredientId) => ingredients.find((i) => i.id === ingredientId)?.name ?? '?');

  // A dish with no critical ingredient at all — whether because none are
  // linked yet, or some are linked but none marked "קריטי" — can never
  // trigger the mobile critical-stock bullets/sold-out state for this dish.
  // Tightened 2026-09-29 (real gap found: a brand-new dish with zero
  // ingredients saved successfully) to require at least one, not just "if
  // any are linked, at least one must be critical" — every dish needs real
  // stock-based availability tracking, matching the same unconditional rule
  // already enforced for add-ons (addonsValid above).
  const noCriticalIngredientMarked = !dishIngredients.some((r) => r.isCritical);

  const canSave =
    name.trim() !== '' &&
    manualPriceValid &&
    sizeOptionsValid &&
    sizeOptionsDiscountValid &&
    discountValid &&
    discountFixedPriceValid &&
    prepTimeValid &&
    addonsValid &&
    drinkAddonsValid &&
    drinkAddonServingVariantsValid &&
    sizesDisabledDuplicateIngredientNames.length === 0 &&
    removedCriticalIngredientNames.length === 0 &&
    !noCriticalIngredientMarked &&
    !saving;

  // Real double-deduction risk, not just a missed setup (2026-09-24): the
  // NULL/"all sizes" row isn't a fallback that a size-specific row replaces
  // — deduct_inventory_for_order sums EVERY row matching an order
  // (dish_size_option_id IS NULL is unconditional), so an ingredient with
  // both a "כל הגדלים" row and a specific-size row gets deducted for BOTH on
  // an order of that size (e.g. 350g "all sizes" + 700g "700 גרם" = 1050g
  // deducted from a single 700g order). Surfaced separately from the softer
  // dishIngredientAllSizesWarning above — this one describes an active
  // over-deduction, not a not-yet-configured recipe.
  const doubleDeductionIngredientNames = Array.from(
    dishIngredients.reduce((map, r) => {
      const scopes = map.get(r.ingredient_id) ?? new Set<'all' | number>();
      scopes.add(r.sizeOptionIndex ?? 'all');
      map.set(r.ingredient_id, scopes);
      return map;
    }, new Map<string, Set<'all' | number>>()),
  )
    .filter(([, scopes]) => scopes.has('all') && scopes.size > 1)
    .map(([ingredientId]) => ingredients.find((i) => i.id === ingredientId)?.name ?? '?');

  function addIngredientChip() {
    const qty = Number(pickQuantity);
    if (!pickIngredientId || !pickQuantity.trim() || Number.isNaN(qty) || qty <= 0) return;
    const ing = ingredients.find((i) => i.id === pickIngredientId);
    if (ing) {
      const requiredInStockUnit = requiredQuantityInStockUnit(qty, pickUnitId, ingredientUnitsMap.get(pickIngredientId) ?? []);
      const errorKey = ingredientQuantityErrorKey(ing, requiredInStockUnit);
      if (errorKey) {
        setPickError(errorKey);
        return;
      }
    }
    setPickError(null);
    const sizeOptionIndex = pickSizeOptionIndex === '' ? undefined : Number(pickSizeOptionIndex);
    setDishIngredients((prev) => {
      // Scoped to the same (ingredient, size) pair — not just the
      // ingredient — so linking "בשר בקר" to the 350g size doesn't silently
      // overwrite an already-linked 700g row for the same ingredient.
      const withoutExisting = prev.filter((r) => !(r.ingredient_id === pickIngredientId && r.sizeOptionIndex === sizeOptionIndex));
      return [...withoutExisting, { ingredient_id: pickIngredientId, quantity_required: pickQuantity, unit_id: pickUnitId || undefined, sizeOptionIndex }];
    });
    setPickIngredientId('');
    setPickQuantity('');
    setPickUnitId('');
    setPickSizeOptionIndex('');
  }

  function removeIngredientChip(ingredientId: string, sizeOptionIndex: number | undefined) {
    setDishIngredients((prev) => prev.filter((r) => !(r.ingredient_id === ingredientId && r.sizeOptionIndex === sizeOptionIndex)));
  }

  function toggleIngredientCritical(ingredientId: string, sizeOptionIndex: number | undefined) {
    setDishIngredients((prev) =>
      prev.map((r) => (r.ingredient_id === ingredientId && r.sizeOptionIndex === sizeOptionIndex ? { ...r, isCritical: !r.isCritical } : r)),
    );
  }

  function handleAddPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newSlots: PhotoSlot[] = Array.from(files).map((file) => ({ kind: 'new', file, previewUrl: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...newSlots]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const removed = prev[index];
      if (removed?.kind === 'new') URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function makePhotoPrimary(index: number) {
    setPhotos((prev) => {
      if (index === 0 || index >= prev.length) return prev;
      const item = prev[index];
      if (!item) return prev;
      const copy = [...prev];
      copy.splice(index, 1);
      copy.unshift(item);
      return copy;
    });
  }

  function addSizeOptionRow() {
    setSizeOptions((prev) => [...prev, { name: '', price: '', discountFixedPrice: '' }]);
  }

  function updateSizeOption(index: number, patch: Partial<SizeOptionRow>) {
    setSizeOptions((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeSizeOptionRow(index: number) {
    setSizeOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function addModifierRow(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>) {
    setRows((prev) => [...prev, { name: '', price: '', photo: null, ingredients: [], servingVariantsEnabled: false, servingVariants: [] }]);
  }

  function setServingVariantsEnabled(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, enabled: boolean) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, servingVariantsEnabled: enabled } : row)));
  }

  function addServingVariantRow(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, containerType: 'bottle' | 'draft') {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, servingVariants: [...row.servingVariants, { containerType, name: '', price: '' }] } : row)),
    );
  }

  function updateServingVariantRow(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, variantIndex: number, patch: Partial<ModifierOptionServingVariantRow>) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, servingVariants: row.servingVariants.map((v, vi) => (vi === variantIndex ? { ...v, ...patch } : v)) } : row,
      ),
    );
  }

  // Removing a variant also clears any ingredient row scoped to it (dropping
  // servingVariantIndex back to "all variants" would silently change what
  // that ingredient requirement means) and re-indexes every other
  // ingredient row's servingVariantIndex to match the shifted array —
  // mirrors how removing a dish size option would need the same care, just
  // not yet needed there since sizeOptionIndex resolution happens against a
  // stable props snapshot instead of live-edited local indices.
  function removeServingVariantRow(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, variantIndex: number) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return {
          ...row,
          servingVariants: row.servingVariants.filter((_, vi) => vi !== variantIndex),
          ingredients: row.ingredients
            .filter((r) => r.servingVariantIndex !== variantIndex)
            .map((r) => (r.servingVariantIndex !== undefined && r.servingVariantIndex > variantIndex ? { ...r, servingVariantIndex: r.servingVariantIndex - 1 } : r)),
        };
      }),
    );
  }

  function updateModifierRow(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, patch: Partial<ModifierOptionRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeModifierRow(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number) {
    setRows((prev) => {
      const removed = prev[index];
      if (removed?.photo?.kind === 'new') URL.revokeObjectURL(removed.photo.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function setModifierRowPhoto(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, file: File | null) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (row.photo?.kind === 'new') URL.revokeObjectURL(row.photo.previewUrl);
        return { ...row, photo: file ? { kind: 'new', file, previewUrl: URL.createObjectURL(file) } : null };
      }),
    );
  }

  // Links an add-on to an ingredient + quantity, so ordering it actually
  // deducts stock the same way ordering the dish itself already does
  // (see modifier_option_ingredients / deduct_inventory_for_order) — the
  // real gap the user asked about after seeing the add-ons editor.
  function addModifierRowIngredient(
    setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>,
    index: number,
    ingredientId: string,
    quantity: string,
    unitId: string,
    servingVariantIndex?: number,
  ) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        // Scoped to the same (ingredient, variant) pair — not just the
        // ingredient — so linking a quantity to "בקבוק" doesn't silently
        // overwrite an already-linked "חבית - ליטר" row for the same
        // ingredient (same reasoning as the dish-level size scoping).
        const withoutExisting = row.ingredients.filter((r) => !(r.ingredient_id === ingredientId && r.servingVariantIndex === servingVariantIndex));
        return { ...row, ingredients: [...withoutExisting, { ingredient_id: ingredientId, quantity_required: quantity, unit_id: unitId || undefined, servingVariantIndex }] };
      }),
    );
  }

  function removeModifierRowIngredient(setRows: Dispatch<SetStateAction<ModifierOptionRow[]>>, index: number, ingredientId: string, servingVariantIndex?: number) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, ingredients: row.ingredients.filter((r) => !(r.ingredient_id === ingredientId && r.servingVariantIndex === servingVariantIndex)) } : row,
      ),
    );
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const photoUrls: string[] = [];
    for (const slot of photos) {
      if (slot.kind === 'existing') {
        photoUrls.push(slot.url);
        continue;
      }
      const ext = slot.file.name.split('.').pop() ?? 'jpg';
      const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('dish-photos')
        .upload(path, slot.file, { contentType: slot.file.type });
      if (uploadError) {
        setError(uploadError.message);
        setSaving(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('dish-photos').getPublicUrl(path);
      photoUrls.push(publicUrlData.publicUrl);
    }

    const payload = {
      restaurant_id: restaurantId,
      category_id: categoryId,
      name: name.trim(),
      description: description.trim() || null,
      price: priceValue,
      photo_urls: photoUrls,
      feedstars_eligible: feedstarsEligible,
      // Mode-exclusive (2026-10-01): only the active mode's field is ever
      // sent as non-default — a percent-mode dish always saves with
      // discount_fixed_price null, a fixed_price-mode dish always saves with
      // discount_percent 0, so the two can never disagree in storage.
      discount_mode: discountMode,
      discount_percent: discountMode === 'percent' ? discountValue : 0,
      discount_fixed_price: discountMode === 'fixed_price' ? discountFixedPriceValue : null,
      prep_time_minutes: prepTimeValue,
    };

    const { data: savedDish, error: saveError } = dish
      ? await supabase.from('dishes').update(payload).eq('id', dish.id).select().single()
      : await supabase.from('dishes').insert(payload).select().single();
    if (saveError || !savedDish) {
      setSaving(false);
      setError(saveError?.message ?? t('genericError'));
      return;
    }

    // Size options: reconciled in place by id, NOT a delete-the-full-set-
    // then-insert-it-fresh replace (like the ingredient links below). Found
    // 2026-09-23: once a size option has ever actually been ordered,
    // order_items.dish_size_option_id references its row with no ON DELETE
    // clause (by design — a past order must keep pointing at a real row for
    // its own history) — so the old delete-everything approach failed there
    // with a silent, unchecked 23503 foreign-key error.
    //
    // 2026-09-29: replaced the delete entirely with a soft-delete
    // (is_active = false), per explicit user request — this recurring
    // conflict kept resurfacing every time a real test order landed on a
    // dish's size option, and the "named error" fix from earlier the same
    // day was only ever a better message for a block that shouldn't have to
    // exist. "Removing" a size option now just hides it (RLS already
    // excludes is_active = false from the diner-facing read policy) and
    // never touches the row, so it can never conflict with historical order
    // data again — no retroactive changes, no risk to existing orders.
    // dish_ingredients links tied to a deactivated size are deleted for real
    // (nothing references dish_ingredients by id, so this is always safe) —
    // they're meaningless once that size is retired.
    //
    // Runs before the ingredient links below (moved here 2026-09-24) so a
    // brand-new size option's real id exists in time to resolve each
    // ingredient row's local sizeOptionIndex against.
    const keptSizeOptionIds = new Set(effectiveSizeOptions.filter((s) => s.id).map((s) => s.id));
    const removedSizeOptionIds = existingSizeOptions.map((s) => s.id).filter((id) => !keptSizeOptionIds.has(id));
    if (removedSizeOptionIds.length > 0) {
      const { error: deactivateError } = await supabase.from('dish_size_options').update({ is_active: false }).in('id', removedSizeOptionIds);
      if (deactivateError) {
        setSaving(false);
        setError(deactivateError.message);
        return;
      }
      await supabase.from('dish_ingredients').delete().in('dish_size_option_id', removedSizeOptionIds);
    }
    for (const [i, s] of effectiveSizeOptions.entries()) {
      if (!s.id) continue;
      const { error: updateError } = await supabase
        .from('dish_size_options')
        .update({
          name: s.name.trim(),
          price: Number(s.price),
          sort_order: i,
          discount_fixed_price: s.discountFixedPrice.trim() === '' ? null : Number(s.discountFixedPrice),
        })
        .eq('id', s.id);
      if (updateError) {
        setSaving(false);
        setError(updateError.message);
        return;
      }
    }
    // Real id per effectiveSizeOptions position — existing rows keep theirs,
    // new ones (inserted below) get theirs back from the insert's own
    // .select(). dishIngredients' sizeOptionIndex resolves against this.
    const savedSizeOptionIds: (string | undefined)[] = effectiveSizeOptions.map((s) => s.id);
    const newSizeOptionPositions = effectiveSizeOptions.reduce<number[]>((acc, s, i) => (s.id ? acc : [...acc, i]), []);
    if (newSizeOptionPositions.length > 0) {
      const { data: insertedSizeOptions, error: insertError } = await supabase
        .from('dish_size_options')
        .insert(
          newSizeOptionPositions.map((i) => {
            const s = effectiveSizeOptions[i]!;
            return {
              dish_id: savedDish.id,
              name: s.name.trim(),
              price: Number(s.price),
              sort_order: i,
              discount_fixed_price: s.discountFixedPrice.trim() === '' ? null : Number(s.discountFixedPrice),
            };
          }),
        )
        .select();
      if (insertError || !insertedSizeOptions) {
        setSaving(false);
        setError(insertError?.message ?? t('genericError'));
        return;
      }
      newSizeOptionPositions.forEach((position, j) => {
        savedSizeOptionIds[position] = insertedSizeOptions[j]?.id;
      });
    }

    // Ingredient links: replaced atomically via the replace_dish_ingredients
    // RPC (2026-09-24) — the previous two-separate-calls delete-then-insert
    // wasn't transactional, and a real save just proved it: the insert
    // failed a unique-constraint check (duplicate ingredient once its
    // size-specific rows collapsed to "all sizes" after turning serving
    // sizes off — sizesDisabledDuplicateIngredientNames above now blocks
    // that specific case before ever reaching here) while the preceding
    // delete had already committed, silently wiping every ingredient link on
    // the dish. A single RPC call is one implicit transaction, so any other
    // insert failure now rolls the delete back too. Each row's local
    // sizeOptionIndex (undefined = applies to every size) is still resolved
    // to a real dish_size_option_id via savedSizeOptionIds above.
    const { error: linkError } = await supabase.rpc('replace_dish_ingredients', {
      p_dish_id: savedDish.id,
      p_rows: dishIngredients.map((r) => ({
        ingredient_id: r.ingredient_id,
        quantity_required: Number(r.quantity_required),
        unit_id: r.unit_id ?? null,
        dish_size_option_id: r.sizeOptionIndex !== undefined ? (savedSizeOptionIds[r.sizeOptionIndex] ?? null) : null,
        is_critical: r.isCritical ?? false,
      })),
    });
    if (linkError) {
      setSaving(false);
      setError(linkError.message);
      return;
    }

    // Add-ons, drink add-ons, and doneness levels: all three are
    // dish_modifier_groups rows under a fixed name (see ADDON_GROUP_NAME/
    // DRINK_ADDON_GROUP_NAME/DONENESS_GROUP_NAME) — the same generic
    // mechanism the mobile ordering flow already reads from.
    // Reconciled in place by id (see saveModifierGroup below), not a
    // delete-then-recreate replace.
    const addonsError = await saveModifierGroup(
      savedDish.id,
      ADDON_GROUP_NAME,
      addonGroupId,
      existingAddonOptionIds,
      addonsEnabled,
      addonOptions,
      addonSelectionType,
      false,
      true,
    );
    if (addonsError) {
      setSaving(false);
      setError(addonsError);
      return;
    }
    const drinkAddonsError = await saveModifierGroup(
      savedDish.id,
      DRINK_ADDON_GROUP_NAME,
      drinkAddonGroupId,
      existingDrinkAddonOptionIds,
      drinkAddonsEnabled,
      drinkAddonOptions,
      drinkAddonSelectionType,
      false,
      true,
    );
    if (drinkAddonsError) {
      setSaving(false);
      setError(drinkAddonsError);
      return;
    }
    const donenessError = await saveModifierGroup(
      savedDish.id,
      DONENESS_GROUP_NAME,
      donenessGroupId,
      existingDonenessOptionIds,
      donenessEnabled,
      donenessOptions,
      'single',
      true,
      false,
    );
    if (donenessError) {
      setSaving(false);
      setError(donenessError);
      return;
    }

    setSaving(false);
    onDone();
  }

  // Reconciled in place by id (2026-09-24) — was a delete-the-whole-group-
  // then-recreate-it replace before. Found via the add-on single/multiple-
  // choice toggle silently never persisting: a dish_modifier_options row's
  // id can be referenced by order_item_modifiers with no ON DELETE clause
  // (default restrict) the moment it's actually been ordered, so deleting
  // the group (which cascades to its options) failed outright with a 23503
  // the instant any option under it had real order history — the exact same
  // bug class as dish_size_options fixed earlier this session, just not
  // caught until now because nothing had exercised an edit-after-ordering
  // path for add-ons before.
  async function saveModifierGroup(
    dishId: string,
    groupName: string,
    existingGroupId: string | undefined,
    existingOptionIds: Set<string>,
    enabled: boolean,
    rows: ModifierOptionRow[],
    selectionType: 'single' | 'multiple',
    isRequired: boolean,
    includePrice: boolean,
  ): Promise<string | null> {
    const validRows = rows.filter((r) => r.name.trim() !== '');

    if (!enabled || validRows.length === 0) {
      if (!existingGroupId) return null;
      const { error: deleteGroupError } = await supabase.from('dish_modifier_groups').delete().eq('id', existingGroupId);
      if (deleteGroupError) return deleteGroupError.code === '23503' ? t('dishModifierGroupInUseError') : deleteGroupError.message;
      return null;
    }

    let groupId = existingGroupId;
    if (groupId) {
      const { error: updateGroupError } = await supabase
        .from('dish_modifier_groups')
        .update({ name: groupName, selection_type: selectionType, is_required: isRequired })
        .eq('id', groupId);
      if (updateGroupError) return updateGroupError.message;
    } else {
      const { data: newGroup, error: groupError } = await supabase
        .from('dish_modifier_groups')
        .insert({ dish_id: dishId, name: groupName, selection_type: selectionType, is_required: isRequired, sort_order: 0 })
        .select()
        .single();
      if (groupError || !newGroup) return groupError?.message ?? t('genericError');
      groupId = newGroup.id;
    }

    const keptOptionIds = new Set(validRows.filter((r) => r.id).map((r) => r.id!));
    const removedOptionIds = [...existingOptionIds].filter((id) => !keptOptionIds.has(id));
    if (removedOptionIds.length > 0) {
      const { error: removeOptionsError } = await supabase.from('dish_modifier_options').delete().in('id', removedOptionIds);
      if (removeOptionsError) return removeOptionsError.code === '23503' ? t('dishModifierOptionInUseError') : removeOptionsError.message;
    }

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]!;
      let photoUrl: string | null = null;
      if (row.photo?.kind === 'existing') {
        photoUrl = row.photo.url;
      } else if (row.photo?.kind === 'new') {
        const ext = row.photo.file.name.split('.').pop() ?? 'jpg';
        const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('dish-photos')
          .upload(path, row.photo.file, { contentType: row.photo.file.type });
        if (uploadError) return uploadError.message;
        photoUrl = supabase.storage.from('dish-photos').getPublicUrl(path).data.publicUrl;
      }

      let optionId = row.id;
      if (optionId) {
        const { error: updateOptionError } = await supabase
          .from('dish_modifier_options')
          .update({
            name: row.name.trim(),
            price_delta: includePrice && row.price.trim() !== '' ? Number(row.price) : 0,
            photo_url: photoUrl,
            sort_order: i,
          })
          .eq('id', optionId);
        if (updateOptionError) return updateOptionError.message;
      } else {
        const { data: newOption, error: optionError } = await supabase
          .from('dish_modifier_options')
          .insert({
            group_id: groupId,
            name: row.name.trim(),
            price_delta: includePrice && row.price.trim() !== '' ? Number(row.price) : 0,
            photo_url: photoUrl,
            sort_order: i,
          })
          .select()
          .single();
        if (optionError || !newOption) return optionError?.message ?? t('genericError');
        optionId = newOption.id;
      }

      // Serving variants (bottle/draft+size, 2026-09-29) — soft-deleted via
      // is_active, mirroring dish_size_options exactly: order_item_modifiers.
      // serving_variant_id references a variant row with no ON DELETE clause
      // once actually ordered. Runs before the ingredient links below so a
      // brand-new variant's real id exists in time to resolve each
      // ingredient row's local servingVariantIndex against — same ordering
      // reason dish size options are saved before dishIngredients.
      const effectiveVariants = row.servingVariantsEnabled ? row.servingVariants : [];
      const keptVariantIds = new Set(effectiveVariants.filter((v) => v.id).map((v) => v.id));
      const existingVariantIds = existingServingVariantIdsByOptionId.get(optionId) ?? new Set<string>();
      const removedVariantIds = Array.from(existingVariantIds).filter((id) => !keptVariantIds.has(id));
      if (removedVariantIds.length > 0) {
        const { error: deactivateVariantsError } = await supabase.from('modifier_option_serving_variants').update({ is_active: false }).in('id', removedVariantIds);
        if (deactivateVariantsError) return deactivateVariantsError.message;
        await supabase.from('modifier_option_ingredients').delete().in('serving_variant_id', removedVariantIds);
      }
      const savedVariantIds: (string | undefined)[] = effectiveVariants.map((v) => v.id);
      for (let vi = 0; vi < effectiveVariants.length; vi++) {
        const v = effectiveVariants[vi]!;
        if (!v.id) continue;
        const { error: updateVariantError } = await supabase
          .from('modifier_option_serving_variants')
          .update({ container_type: v.containerType, name: v.name.trim(), price_delta: v.price.trim() !== '' ? Number(v.price) : 0, sort_order: vi })
          .eq('id', v.id);
        if (updateVariantError) return updateVariantError.message;
      }
      const newVariantPositions = effectiveVariants.reduce<number[]>((acc, v, vi) => (v.id ? acc : [...acc, vi]), []);
      if (newVariantPositions.length > 0) {
        const { data: insertedVariants, error: insertVariantsError } = await supabase
          .from('modifier_option_serving_variants')
          .insert(
            newVariantPositions.map((vi) => {
              const v = effectiveVariants[vi]!;
              return {
                modifier_option_id: optionId,
                container_type: v.containerType,
                name: v.name.trim(),
                price_delta: v.price.trim() !== '' ? Number(v.price) : 0,
                sort_order: vi,
              };
            }),
          )
          .select();
        if (insertVariantsError || !insertedVariants) return insertVariantsError?.message ?? t('genericError');
        newVariantPositions.forEach((position, j) => {
          savedVariantIds[position] = insertedVariants[j]?.id;
        });
      }

      // Ingredient links per option: still a plain full replace — nothing
      // references a modifier_option_ingredients row by id (only cascading
      // FKs both directions), unlike the option row itself.
      const { error: deleteIngredientsError } = await supabase.from('modifier_option_ingredients').delete().eq('modifier_option_id', optionId);
      if (deleteIngredientsError) return deleteIngredientsError.message;
      const validIngredientRows = row.ingredients.filter((r) => r.ingredient_id && r.quantity_required.trim() !== '');
      if (validIngredientRows.length > 0) {
        const { error: ingredientLinkError } = await supabase.from('modifier_option_ingredients').insert(
          validIngredientRows.map((r) => ({
            modifier_option_id: optionId,
            ingredient_id: r.ingredient_id,
            quantity_required: Number(r.quantity_required),
            unit_id: r.unit_id ?? null,
            serving_variant_id: r.servingVariantIndex !== undefined ? (savedVariantIds[r.servingVariantIndex] ?? null) : null,
          })),
        );
        if (ingredientLinkError) return ingredientLinkError.message;
      }
    }
    return null;
  }

  return (
    <div className="mt-2 rounded border border-border bg-surface p-3">
      <label className="mb-1 block text-sm font-semibold text-ink">{t(isDrink ? 'dishNamePlaceholderDrink' : 'dishNamePlaceholder')}</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t(isDrink ? 'dishNamePlaceholderDrink' : 'dishNamePlaceholder')}
        className="mb-4 w-64 max-w-full rounded border border-border px-2 py-1.5 text-sm"
      />
      {/* Manual price field removed once serving options are on (2026-09-23,
          per the user's request) — dishes.price is kept in sync from the
          default size option instead (see priceValue above), so showing
          both here would just invite them to disagree. Still shown for a
          dish with no serving options at all, which has nowhere else to
          get a price from. */}
      {!servingOptionsEnabled && (
        <>
          {/* Required + must be > 0 (2026-09-29, per explicit request) —
              with serving options off, this manual price is the dish's only
              price at all, so 0/empty is never a real, sellable state. */}
          <label className="mb-1 block text-sm font-semibold text-ink">
            {t('dishPricePlaceholder')} <span className="text-danger">*</span>
          </label>
          <div className="relative mb-1 w-28">
            <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-sm text-muted-foreground">
              ₪
            </span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={t('dishPricePlaceholder')}
              className="w-full rounded border border-border py-1.5 ps-6 pe-2 text-sm"
            />
          </div>
          <p className="mb-4 text-xs text-danger">{!manualPriceValid ? t('dishPriceRequiredError') : ' '}</p>
        </>
      )}
      <label className="mb-1 block text-sm font-semibold text-ink">{t('dishDescriptionLabel')}</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
        placeholder={t('dishDescriptionPlaceholder')}
        rows={3}
        className="mb-1 w-full resize-y rounded border border-border px-2 py-1.5 text-sm"
      />
      <p className="mb-2 text-end text-[10px] text-muted-foreground">
        {description.length}/{MAX_DESCRIPTION_LENGTH}
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={feedstarsEligible}
          onChange={(e) => setFeedstarsEligible(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        {t(isDrink ? 'dishFeedstarsEligibleLabelDrink' : 'dishFeedstarsEligibleLabel')}
      </label>
      <div className="mb-3">
        <label className="mb-1 block text-sm font-semibold text-ink">{t('dishDiscountLabel')}</label>
        {/* Mode toggle (2026-10-01, per explicit request) — same segmented-
            button pattern as AddonSelectionTypeToggle above. Fixed-price mode
            is disabled (not hidden — staff should see why) once the dish has
            size options, since one fixed price can't apply to several
            differently-priced sizes. */}
        <div className="mb-2 inline-flex shrink-0 rounded border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setDiscountMode('percent')}
            className={`rounded px-2.5 py-1 font-medium transition-colors ${discountMode === 'percent' ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent-soft'}`}
          >
            {t('dishDiscountModePercent')}
          </button>
          <button
            type="button"
            disabled={effectiveSizeOptions.length > 0}
            onClick={() => setDiscountMode('fixed_price')}
            className={`rounded px-2.5 py-1 font-medium transition-colors ${
              discountMode === 'fixed_price'
                ? 'bg-accent text-white'
                : effectiveSizeOptions.length > 0
                  ? 'cursor-not-allowed text-muted-foreground opacity-50'
                  : 'text-muted-foreground hover:bg-accent-soft'
            }`}
          >
            {t('dishDiscountModeFixedPrice')}
          </button>
        </div>
        {discountMode === 'percent' ? (
          <div className="relative w-24">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              placeholder="0"
              className="w-full rounded border border-border py-1.5 ps-2 pe-6 text-sm"
            />
            <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-sm text-muted-foreground">%</span>
          </div>
        ) : (
          <div className="relative w-24">
            <input
              type="number"
              min="0"
              step="1"
              value={discountFixedPrice}
              onChange={(e) => setDiscountFixedPrice(e.target.value)}
              placeholder="0"
              className="w-full rounded border border-border py-1.5 ps-2 pe-6 text-sm"
            />
            <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-sm text-muted-foreground">₪</span>
          </div>
        )}
        <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
          <span>{t(discountMode === 'percent' ? 'dishDiscountHint' : 'dishDiscountFixedPriceHint')}</span>
        </p>
        {fixedPriceModeBlockedBySizes && <p className="mt-1 text-[11px] font-medium text-danger">{t('dishDiscountFixedPriceBlockedBySizesError')}</p>}
        {discountMode === 'fixed_price' && !fixedPriceModeBlockedBySizes && discountFixedPrice.trim() !== '' && !discountFixedPriceValid && (
          <p className="mt-1 text-[11px] font-medium text-danger">{t('dishDiscountFixedPriceRangeError')}</p>
        )}
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-sm font-semibold text-ink">{t('dishPrepTimeLabel')}</label>
        <div className="relative w-24">
          <input
            type="number"
            min="1"
            step="1"
            value={prepTimeMinutes}
            onChange={(e) => setPrepTimeMinutes(e.target.value)}
            placeholder="—"
            className="w-full rounded border border-border py-1.5 ps-2 pe-10 text-sm"
          />
          <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-sm text-muted-foreground">{t('dishPrepTimeUnit')}</span>
        </div>
        <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
          <span>{t('dishPrepTimeHint')}</span>
        </p>
      </div>
      <div className="mb-3">
        {photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {photos.map((slot, index) => (
              <div key={slot.kind === 'existing' ? slot.url : slot.previewUrl} className="relative">
                <img
                  src={slot.kind === 'existing' ? slot.url : slot.previewUrl}
                  alt=""
                  className="h-16 w-16 rounded object-cover"
                  style={{ borderWidth: index === 0 ? 2 : 1, borderStyle: 'solid', borderColor: index === 0 ? 'var(--accent)' : 'var(--border)' }}
                />
                {index === 0 && (
                  <span className="absolute start-0.5 top-0.5 rounded bg-accent px-1 py-0.5 text-[9px] font-semibold text-white">
                    {t('dishPhotoPrimaryBadge')}
                  </span>
                )}
                <Tooltip content={t('dishPhotoRemove')}>
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    aria-label={t('dishPhotoRemove')}
                    className="absolute -end-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-white hover:opacity-90"
                  >
                    <TrashIcon className="h-2.5 w-2.5" />
                  </button>
                </Tooltip>
                {index !== 0 && (
                  <button
                    type="button"
                    onClick={() => makePhotoPrimary(index)}
                    className="absolute inset-x-0 bottom-0 truncate rounded-b bg-black/55 px-1 text-[9px] font-medium text-white hover:bg-black/70"
                  >
                    {t('dishPhotoMakePrimary')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent-soft"
        >
          {t('dishPhotoAdd')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleAddPhotos(e.target.files)}
        />
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-base font-bold text-ink">{t(isDrink ? 'dishSizeOptionsLabelDrink' : 'dishSizeOptionsLabel')}</p>
          <Toggle checked={servingOptionsEnabled} onChange={setServingOptionsEnabled} label={t(isDrink ? 'dishSizeOptionsLabelDrink' : 'dishSizeOptionsLabel')} />
        </div>
        {servingOptionsEnabled && (
          <>
            <p className="mb-2 flex items-start gap-1 text-[11px] text-muted-foreground">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span>{t(isDrink ? 'dishSizeOptionsHintDrink' : 'dishSizeOptionsHint')}</span>
            </p>
            {sizeOptions.length > 0 && (
              <div className="mb-2 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span className="w-32 shrink-0">{t('dishSizeOptionNameColumnLabel')}</span>
                  <span className="w-20 shrink-0">{t('dishSizeOptionPriceColumnLabel')}</span>
                  <span className="w-24 shrink-0">{t('dishSizeOptionDiscountColumnLabel')}</span>
                  <span className="h-6 w-6 shrink-0" />
                </div>
                {sizeOptions.map((row, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateSizeOption(index, { name: e.target.value })}
                      placeholder={t('dishSizeOptionNamePlaceholder')}
                      className="w-32 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
                    />
                    <div className="relative w-20 shrink-0">
                      <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-xs text-muted-foreground">₪</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={row.price}
                        onChange={(e) => updateSizeOption(index, { price: e.target.value })}
                        placeholder={t('dishSizeOptionPricePlaceholder')}
                        className="w-full rounded border border-border py-1.5 ps-5 pe-1 text-xs"
                      />
                    </div>
                    {/* Per-size fixed-price discount override (2026-10-01,
                        per explicit request) — optional; empty means this
                        size just follows the dish's own discount_percent
                        (unchanged, uniform-across-sizes behavior). */}
                    <Tooltip content={t('dishSizeOptionDiscountHint')}>
                      <div className="relative w-24 shrink-0">
                        <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-xs text-muted-foreground">₪</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={row.discountFixedPrice}
                          onChange={(e) => updateSizeOption(index, { discountFixedPrice: e.target.value })}
                          placeholder={t('dishSizeOptionDiscountPlaceholder')}
                          className="w-full rounded border border-border py-1.5 ps-5 pe-1 text-xs"
                        />
                      </div>
                    </Tooltip>
                    <Tooltip content={t('dishSizeOptionRemove')}>
                      <button
                        type="button"
                        onClick={() => removeSizeOptionRow(index)}
                        aria-label={t('dishSizeOptionRemove')}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
            {!sizeOptionsDiscountValid && (
              <p className="mb-2 flex items-start gap-1 text-[11px] text-danger">
                <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                <span>{t('dishSizeOptionDiscountRangeError').replace('{sizes}', sizeOptionsInvalidDiscountNames.join(', '))}</span>
              </p>
            )}
            <button
              type="button"
              onClick={addSizeOptionRow}
              className="rounded border border-dashed border-border-strong px-2 py-1 text-xs text-accent hover:bg-accent-soft"
            >
              {t('dishSizeOptionAdd')}
            </button>
          </>
        )}
      </div>

      <ModifierSection
        enabled={addonsEnabled}
        onToggle={setAddonsEnabled}
        label={t('dishAddonsLabel')}
        hint={t('dishAddonsHint')}
        namePlaceholder={t('dishAddonNamePlaceholder')}
        pricePlaceholder={t('dishAddonPricePlaceholder')}
        addLabel={t('dishAddonAdd')}
        removeLabel={t('dishAddonRemove')}
        includePrice
        ingredients={ingredients}
        ingredientUnitsMap={ingredientUnitsMap}
        rows={addonOptions}
        onAdd={() => addModifierRow(setAddonOptions)}
        onUpdate={(index, patch) => updateModifierRow(setAddonOptions, index, patch)}
        onRemove={(index) => removeModifierRow(setAddonOptions, index)}
        onPhotoChange={(index, file) => setModifierRowPhoto(setAddonOptions, index, file)}
        onAddIngredient={(index, ingredientId, quantity, unitId) => addModifierRowIngredient(setAddonOptions, index, ingredientId, quantity, unitId)}
        extraHeaderContent={<AddonSelectionTypeToggle value={addonSelectionType} onChange={setAddonSelectionType} />}
        errorContent={
          addonsMissingIngredientNames.length > 0 && (
            <p className="mb-2 flex items-start gap-1 text-[11px] text-danger">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>{t('dishAddonMissingIngredientError').replace('{addons}', addonsMissingIngredientNames.join(', '))}</span>
            </p>
          )
        }
      />

      <ModifierSection
        enabled={drinkAddonsEnabled}
        onToggle={setDrinkAddonsEnabled}
        label={t('dishDrinkAddonsLabel')}
        hint={t('dishDrinkAddonsHint')}
        namePlaceholder={t('dishDrinkAddonNamePlaceholder')}
        pricePlaceholder={t('dishDrinkAddonPricePlaceholder')}
        addLabel={t('dishDrinkAddonAdd')}
        removeLabel={t('dishDrinkAddonRemove')}
        includePrice
        ingredients={ingredients}
        ingredientUnitsMap={ingredientUnitsMap}
        rows={drinkAddonOptions}
        onAdd={() => addModifierRow(setDrinkAddonOptions)}
        onUpdate={(index, patch) => updateModifierRow(setDrinkAddonOptions, index, patch)}
        onRemove={(index) => removeModifierRow(setDrinkAddonOptions, index)}
        onPhotoChange={(index, file) => setModifierRowPhoto(setDrinkAddonOptions, index, file)}
        onAddIngredient={(index, ingredientId, quantity, unitId, servingVariantIndex) =>
          addModifierRowIngredient(setDrinkAddonOptions, index, ingredientId, quantity, unitId, servingVariantIndex)
        }
        extraHeaderContent={<AddonSelectionTypeToggle value={drinkAddonSelectionType} onChange={setDrinkAddonSelectionType} />}
        errorContent={
          <>
            {drinkAddonsMissingIngredientNames.length > 0 && (
              <p className="mb-2 flex items-start gap-1 text-[11px] text-danger">
                <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                <span>{t('dishAddonMissingIngredientError').replace('{addons}', drinkAddonsMissingIngredientNames.join(', '))}</span>
              </p>
            )}
            {drinkAddonsMissingVariantIngredientLabels.length > 0 && (
              <p className="mb-2 flex items-start gap-1 text-[11px] text-danger">
                <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                <span>{t('dishServingVariantMissingIngredientError').replace('{variants}', drinkAddonsMissingVariantIngredientLabels.join(', '))}</span>
              </p>
            )}
          </>
        }
        enableServingVariants
        onToggleServingVariants={(index, enabled) => setServingVariantsEnabled(setDrinkAddonOptions, index, enabled)}
        onAddServingVariant={(index, containerType) => addServingVariantRow(setDrinkAddonOptions, index, containerType)}
        onUpdateServingVariant={(index, variantIndex, patch) => updateServingVariantRow(setDrinkAddonOptions, index, variantIndex, patch)}
        onRemoveServingVariant={(index, variantIndex) => removeServingVariantRow(setDrinkAddonOptions, index, variantIndex)}
      />

      <ModifierSection
        enabled={donenessEnabled}
        onToggle={setDonenessEnabled}
        label={t('dishDonenessLabel')}
        hint={t('dishDonenessHint')}
        namePlaceholder={t('dishDonenessNamePlaceholder')}
        addLabel={t('dishDonenessAdd')}
        removeLabel={t('dishDonenessRemove')}
        includePrice={false}
        rows={donenessOptions}
        onAdd={() => addModifierRow(setDonenessOptions)}
        onUpdate={(index, patch) => updateModifierRow(setDonenessOptions, index, patch)}
        onRemove={(index) => removeModifierRow(setDonenessOptions, index)}
        onPhotoChange={(index, file) => setModifierRowPhoto(setDonenessOptions, index, file)}
      />

      {ingredients.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-ink">{t(isDrink ? 'dishIngredientsLabelDrink' : 'dishIngredientsLabel')}</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <select
              value={pickIngredientId}
              onChange={(e) => {
                setPickIngredientId(e.target.value);
                setPickUnitId('');
                setPickError(null);
              }}
              className="w-40 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
            >
              <option value="">{t('dishIngredientPickPlaceholder')}</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={pickQuantity}
              onChange={(e) => {
                setPickQuantity(e.target.value);
                setPickError(null);
              }}
              placeholder={t('dishIngredientQuantityPlaceholder')}
              className="w-20 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
            />
            <select
              value={pickUnitId}
              onChange={(e) => {
                setPickUnitId(e.target.value);
                setPickError(null);
              }}
              className="w-24 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
            >
              <option value="">{ingredients.find((i) => i.id === pickIngredientId)?.unit ?? t('dishIngredientUnitPlaceholder')}</option>
              {(ingredientUnitsMap.get(pickIngredientId) ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {effectiveSizeOptions.length > 1 && (
              <select
                value={pickSizeOptionIndex}
                onChange={(e) => setPickSizeOptionIndex(e.target.value)}
                className="w-28 shrink-0 rounded border border-border px-2 py-1.5 text-xs"
              >
                <option value="">{t('dishIngredientAllSizesOption')}</option>
                {effectiveSizeOptions.map((s, i) => (
                  <option key={s.id ?? `new-${i}`} value={i}>
                    {s.name || t('dishSizeOptionNamePlaceholder')}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={addIngredientChip}
              className="shrink-0 rounded bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white"
            >
              {t('addIngredientToDish')}
            </button>
          </div>
          {pickError &&
            (() => {
              const ing = ingredients.find((i) => i.id === pickIngredientId);
              if (!ing) return null;
              return (
                <p className="mb-2 flex items-start gap-1 text-[11px] text-danger">
                  <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                  <span>
                    {t(pickError)
                      .replace('{required}', String(requiredQuantityInStockUnit(Number(pickQuantity), pickUnitId, ingredientUnitsMap.get(pickIngredientId) ?? [])))
                      .replaceAll('{unit}', ing.unit)
                      .replace('{stock}', String(ing.quantity_in_stock))
                      .replace('{threshold}', String(ing.threshold_quantity))}
                  </span>
                </p>
              );
            })()}
          {dishIngredients.length === 0 && <p className="text-[11px] text-muted-foreground">{t(isDrink ? 'dishIngredientsEmptyDrink' : 'dishIngredientsEmpty')}</p>}
          {/* Surfaces the exact trap a real test just hit (2026-09-24): a
              dish with 2+ serving sizes but every linked ingredient still set
              to "כל הגדלים" silently deducts the identical quantity no matter
              which size is ordered — e.g. a 700g steak deducting the same
              350g as the smaller size, since nothing ever overrode it per
              size. Not a save-blocking error (a genuinely size-independent
              recipe — same garnish regardless of portion — is a real,
              valid case), just a heads-up nudge to go add a size-specific
              link via the size picker above if that's not actually intended. */}
          {effectiveSizeOptions.length > 1 && dishIngredients.length > 0 && dishIngredients.every((r) => r.sizeOptionIndex === undefined) && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-warning">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{t('dishIngredientAllSizesWarning')}</span>
            </p>
          )}
          {doubleDeductionIngredientNames.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>{t('dishIngredientDoubleDeductionWarning').replace('{ingredients}', doubleDeductionIngredientNames.join(', '))}</span>
            </p>
          )}
          {sizesDisabledDuplicateIngredientNames.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>{t('dishIngredientSizesDisabledDuplicateWarning').replace('{ingredients}', sizesDisabledDuplicateIngredientNames.join(', '))}</span>
            </p>
          )}
          {removedCriticalIngredientNames.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>{t('dishIngredientRemovedCriticalWarning').replace('{ingredients}', removedCriticalIngredientNames.join(', '))}</span>
            </p>
          )}
        </div>
      )}

      {/* Rendered unconditionally (2026-09-29, real gap found: a brand-new
          dish with zero ingredients — and this restaurant's inventory list
          itself possibly empty too — saved with no error shown at all,
          because this used to live inside the `ingredients.length > 0`
          block above and simply never rendered when that block was hidden,
          even though canSave was already correctly blocking the save). This
          is the one save-blocking condition here that can be true even when
          the restaurant has no ingredients defined anywhere yet, so it can't
          depend on that block being visible. */}
      {noCriticalIngredientMarked && (
        <p className="mb-3 -mt-2 flex items-start gap-1 text-[11px] text-danger">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <span>{t('dishNoCriticalIngredientError')}</span>
        </p>
      )}

      {(dishIngredients.length > 0 || addonOptions.some((row) => row.ingredients.length > 0) || drinkAddonOptions.some((row) => row.ingredients.length > 0)) && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-ink">{t('dishIngredientTagsConsolidatedLabel')}</p>
          <div className="flex flex-wrap gap-1.5">
            {dishIngredients.map((r) => {
              const ing = ingredients.find((i) => i.id === r.ingredient_id);
              const altUnit = r.unit_id ? (ingredientUnitsMap.get(r.ingredient_id) ?? []).find((u) => u.id === r.unit_id) : undefined;
              const status = ing ? ingredientStockStatus(ing) : null;
              // Only shown once there's more than one size to disambiguate
              // between — a dish with 0 or 1 size option has nothing for
              // sizeOptionIndex to ever meaningfully point at.
              const sizeLabel =
                effectiveSizeOptions.length > 1
                  ? r.sizeOptionIndex !== undefined
                    ? effectiveSizeOptions[r.sizeOptionIndex]?.name || t('dishSizeOptionNamePlaceholder')
                    : t('dishIngredientAllSizesOption')
                  : null;
              return (
                <span
                  key={`dish-${r.ingredient_id}-${r.sizeOptionIndex ?? 'all'}`}
                  className={`flex items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1.5 text-[11px] font-medium ${status ? status.cls : 'bg-accent-soft text-accent'}`}
                >
                  {sizeLabel && `${sizeLabel}: `}
                  {ing?.name ?? '?'} — {r.quantity_required} {altUnit?.name ?? ing?.unit}
                  {ing &&
                    ` (${t('dishIngredientStockDeductionLabel')}: ${formatQuantity(
                      requiredQuantityInStockUnit(Number(r.quantity_required), r.unit_id ?? '', ingredientUnitsMap.get(r.ingredient_id) ?? []),
                    )} ${ing.unit})`}
                  {/* Marks this specific ingredient link as "critical" for
                      the dish (2026-09-24) — surfaced to diners on mobile as
                      a low/out-of-stock warning on the dish itself. Only on
                      dish-level tags, not add-on ones (no equivalent flag
                      there). */}
                  <Tooltip content={t('dishIngredientCriticalHint')}>
                    <button
                      type="button"
                      onClick={() => toggleIngredientCritical(r.ingredient_id, r.sizeOptionIndex)}
                      aria-pressed={r.isCritical ?? false}
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${r.isCritical ? 'bg-danger text-white' : 'bg-black/10 text-current'}`}
                    >
                      {t('dishIngredientCriticalToggle')}
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => removeIngredientChip(r.ingredient_id, r.sizeOptionIndex)}
                    aria-label={t('dishSizeOptionRemove')}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 hover:bg-black/20"
                  >
                    <CloseIcon className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
            {addonOptions.flatMap((row, optIndex) =>
              row.ingredients.map((r) => {
                const ing = ingredients.find((i) => i.id === r.ingredient_id);
                const altUnit = r.unit_id ? (ingredientUnitsMap.get(r.ingredient_id) ?? []).find((u) => u.id === r.unit_id) : undefined;
                const status = ing ? ingredientStockStatus(ing) : null;
                return (
                  <span
                    key={`addon-${optIndex}-${r.ingredient_id}`}
                    className={`flex items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1.5 text-[11px] font-medium ${status ? status.cls : 'bg-accent-soft text-accent'}`}
                  >
                    {row.name.trim() || t('dishAddonNamePlaceholder')}: {ing?.name ?? '?'} — {r.quantity_required} {altUnit?.name ?? ing?.unit}
                    {ing &&
                      ` (${t('dishIngredientStockDeductionLabel')}: ${formatQuantity(
                        requiredQuantityInStockUnit(Number(r.quantity_required), r.unit_id ?? '', ingredientUnitsMap.get(r.ingredient_id) ?? []),
                      )} ${ing.unit})`}
                    <button
                      type="button"
                      onClick={() => removeModifierRowIngredient(setAddonOptions, optIndex, r.ingredient_id)}
                      aria-label={t('dishSizeOptionRemove')}
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 hover:bg-black/20"
                    >
                      <CloseIcon className="h-2.5 w-2.5" />
                    </button>
                  </span>
                );
              }),
            )}
            {drinkAddonOptions.flatMap((row, optIndex) =>
              row.ingredients.map((r) => {
                const ing = ingredients.find((i) => i.id === r.ingredient_id);
                const altUnit = r.unit_id ? (ingredientUnitsMap.get(r.ingredient_id) ?? []).find((u) => u.id === r.unit_id) : undefined;
                const status = ing ? ingredientStockStatus(ing) : null;
                const variant = r.servingVariantIndex !== undefined ? row.servingVariants[r.servingVariantIndex] : undefined;
                return (
                  <span
                    key={`drink-addon-${optIndex}-${r.ingredient_id}-${r.servingVariantIndex ?? 'all'}`}
                    className={`flex items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1.5 text-[11px] font-medium ${status ? status.cls : 'bg-accent-soft text-accent'}`}
                  >
                    {row.name.trim() || t('dishDrinkAddonNamePlaceholder')}
                    {variant &&
                      ` (${t(variant.containerType === 'bottle' ? 'dishServingVariantBottleLabel' : 'dishServingVariantDraftLabel')} - ${variant.name.trim() || t('dishServingVariantNamePlaceholder')})`}
                    : {ing?.name ?? '?'} — {r.quantity_required} {altUnit?.name ?? ing?.unit}
                    {ing &&
                      ` (${t('dishIngredientStockDeductionLabel')}: ${formatQuantity(
                        requiredQuantityInStockUnit(Number(r.quantity_required), r.unit_id ?? '', ingredientUnitsMap.get(r.ingredient_id) ?? []),
                      )} ${ing.unit})`}
                    <button
                      type="button"
                      onClick={() => removeModifierRowIngredient(setDrinkAddonOptions, optIndex, r.ingredient_id, r.servingVariantIndex)}
                      aria-label={t('dishSizeOptionRemove')}
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 hover:bg-black/20"
                    >
                      <CloseIcon className="h-2.5 w-2.5" />
                    </button>
                  </span>
                );
              }),
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {saving ? t('saving') : t(isDrink ? 'saveDishDrink' : 'saveDish')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
        >
          {t('cancel')}
        </button>
      </div>
      {/* Moved below the save/cancel row (2026-09-29, per explicit request)
          — was at the very top of this long form, requiring a scroll back up
          to see why a save failed; now it's right where the admin's eyes
          already are after clicking שמירה. */}
      {error && (
        <p ref={errorRef} className="mt-2 rounded border border-danger/30 bg-danger-soft p-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
