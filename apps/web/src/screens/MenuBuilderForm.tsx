import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Dish, MenuCategory, Restaurant } from '@feedbook/types';
import { WizardStepper } from '../components/WizardStepper';
import { AppHeader } from '../components/AppHeader';
import { useI18n } from '../lib/i18n';

interface Props {
  restaurant: Restaurant;
  categories: MenuCategory[];
  dishes: Dish[];
  onRefresh: () => void;
  onNext: () => void;
}

// AFD §3.7.1 screen 4: "בניית תפריט ראשוני" — at least one category and a
// minimum number of dishes (name, price, description, photo) is a
// submission requirement. The exact minimum dish count is business-defined
// and, per Content Guidelines §2.10, not yet set — this screen enforces the
// one part that IS defined (>=1 category, >=1 dish) and leaves the number
// itself easy to raise in one place (MIN_DISHES) once decided.
const MIN_DISHES = 1;

// dishes.description has a matching char_length <= 400 DB constraint
// (dish_description_length migration) — keep the two in sync.
const MAX_DESCRIPTION_LENGTH = 400;

export function MenuBuilderForm({ restaurant, categories, dishes, onRefresh, onNext }: Props) {
  const { t } = useI18n();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = categories.length > 0 && dishes.length >= MIN_DISHES;

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setAddingCategory(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('menu_categories')
      .insert({ restaurant_id: restaurant.id, name, sort_order: categories.length });
    setAddingCategory(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewCategoryName('');
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
    <div className="flex min-h-screen items-center justify-center bg-background py-10">
      <div className="card w-full max-w-lg p-8">
        <AppHeader restaurantName={restaurant.name} restaurantAddress={restaurant.address ?? undefined} />
        <WizardStepper currentStep={3} />
        <h1 className="mb-1 text-xl font-bold text-ink">{t('menuStepTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('menuStepSubtitle')}</p>

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
              onRefresh={onRefresh}
              onDeleteCategory={() => void handleDeleteCategory(category.id)}
            />
          ))}
        </div>

        <div className="mb-6 flex gap-2">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={t('categoryNamePlaceholder')}
            className="flex-1 rounded border border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleAddCategory()}
            disabled={!newCategoryName.trim() || addingCategory}
            className="rounded bg-accent-soft px-4 py-2 text-sm font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50"
          >
            {t('addCategory')}
          </button>
        </div>

        {!canContinue && <p className="mb-4 text-xs text-muted-foreground">{t('menuMinimumNotMet')}</p>}

        <button
          type="button"
          onClick={onNext}
          disabled={!canContinue}
          className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {t('continue')}
        </button>
      </div>
    </div>
  );
}

function CategoryCard({
  category,
  dishes,
  onRefresh,
  onDeleteCategory,
}: {
  category: MenuCategory;
  dishes: Dish[];
  onRefresh: () => void;
  onDeleteCategory: () => void;
}) {
  const { t } = useI18n();
  const [addingDish, setAddingDish] = useState(false);

  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-ink">{category.name}</h2>
        <button type="button" onClick={onDeleteCategory} className="text-xs text-danger hover:underline">
          {t('deleteCategory')}
        </button>
      </div>

      <div className="space-y-2">
        {dishes.map((dish) => (
          <DishRow key={dish.id} dish={dish} onRefresh={onRefresh} />
        ))}
      </div>

      {addingDish ? (
        <NewDishForm
          categoryId={category.id}
          restaurantId={category.restaurant_id}
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
          {t('addDish')}
        </button>
      )}
    </div>
  );
}

function DishRow({ dish, onRefresh }: { dish: Dish; onRefresh: () => void }) {
  const { t } = useI18n();

  async function handleDelete() {
    await supabase.from('dishes').delete().eq('id', dish.id);
    onRefresh();
  }

  return (
    <div className="flex items-center gap-3 rounded bg-surface p-2">
      {dish.photo_urls[0] ? (
        <img src={dish.photo_urls[0]} alt={dish.name} className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded bg-surface-2" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{dish.name}</p>
        <p className="truncate text-xs text-muted-foreground">{dish.description}</p>
      </div>
      <p className="shrink-0 text-sm font-medium text-ink">₪{dish.price}</p>
      <button type="button" onClick={() => void handleDelete()} className="shrink-0 text-xs text-danger hover:underline">
        {t('deleteDish')}
      </button>
    </div>
  );
}

function NewDishForm({
  categoryId,
  restaurantId,
  onDone,
  onCancel,
}: {
  categoryId: string;
  restaurantId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const priceValue = Number(price);
  const canSave = name.trim() !== '' && price.trim() !== '' && !Number.isNaN(priceValue) && priceValue >= 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    let photoUrls: string[] = [];
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() ?? 'jpg';
      const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('dish-photos')
        .upload(path, photoFile, { contentType: photoFile.type });
      if (uploadError) {
        setError(uploadError.message);
        setSaving(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('dish-photos').getPublicUrl(path);
      photoUrls = [publicUrlData.publicUrl];
    }

    const { error: insertError } = await supabase.from('dishes').insert({
      restaurant_id: restaurantId,
      category_id: categoryId,
      name: name.trim(),
      description: description.trim() || null,
      price: priceValue,
      photo_urls: photoUrls,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onDone();
  }

  return (
    <div className="mt-2 rounded border border-border bg-surface p-3">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('dishNamePlaceholder')}
        className="mb-2 w-full rounded border border-border px-2 py-1.5 text-sm"
      />
      <div className="relative mb-2 w-28">
        <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-sm text-muted-foreground">
          ₪
        </span>
        <input
          type="number"
          min="0"
          step="0.1"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={t('dishPricePlaceholder')}
          className="w-full rounded border border-border py-1.5 ps-6 pe-2 text-sm"
        />
      </div>
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
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent-soft"
        >
          {photoFile ? photoFile.name : t('dishPhotoUpload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {saving ? t('saving') : t('saveDish')}
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
