import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Dish, DishSizeOption, Ingredient, MenuCategory, Restaurant } from '@feedbook/types';
import { supabase } from '../lib/supabase';
import { WizardShell } from '../components/WizardShell';
import { MenuManager } from '../components/MenuManager';
import { useI18n } from '../lib/i18n';

interface Props {
  session: Session;
  restaurant: Restaurant;
  categories: MenuCategory[];
  dishes: Dish[];
  dishSizeOptions: DishSizeOption[];
  ingredients: Ingredient[];
  onRefresh: () => void;
  onNext: () => void;
  onSeating: () => void;
  // Free step-bar navigation. Every already-added category/dish is already
  // saved (each has its own explicit save action) — the only real risk is a
  // category name mid-typed in MenuManager's "add category" field, reported
  // up via onDraftChange below and used to gate WizardShell's leave-confirm.
  // An in-progress "add dish" sub-form nested inside a specific category
  // isn't covered by that signal (would need lifting state through
  // CategoryCard too) — still an acceptable, ordinary discardable draft for
  // that narrower case, same as leaving any unsubmitted form.
  onStepClick?: (step: number) => void;
  onExit?: () => void;
}

// AFD §3.7.1 screen 4: "בניית תפריט ראשוני" — at least one category and a
// minimum number of dishes (name, price, description, photo) is a
// submission requirement. The exact minimum dish count is business-defined
// and, per Content Guidelines §2.10, not yet set — this screen enforces the
// one part that IS defined (>=1 category, >=1 dish) and leaves the number
// itself easy to raise in one place (MIN_DISHES) once decided.
export const MIN_DISHES = 1;

export function MenuBuilderForm({ session, restaurant, categories, dishes, dishSizeOptions, ingredients, onRefresh, onNext, onSeating, onStepClick, onExit }: Props) {
  const { t } = useI18n();
  const canContinue = categories.length > 0 && dishes.length >= MIN_DISHES;
  const [hasDraft, setHasDraft] = useState(false);

  return (
    <WizardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      userEmail={session.user.email}
      onSignOut={() => void supabase.auth.signOut()}
      currentStep={3}
      activeSubStep="menu"
      isDirty={hasDraft}
      onSubStepClick={(subStep) => {
        if (subStep === 'seating') onSeating();
      }}
      onStepClick={onStepClick}
      onExit={onExit}
    >
      <div className="card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('menuSetupTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('menuStepSubtitle')}</p>

        <MenuManager
          restaurantId={restaurant.id}
          categories={categories}
          dishes={dishes}
          dishSizeOptions={dishSizeOptions}
          ingredients={ingredients}
          onRefresh={onRefresh}
          onDraftChange={setHasDraft}
        />

        {!canContinue && <p className="mb-4 mt-6 text-xs text-muted-foreground">{t('menuMinimumNotMet')}</p>}

        <button
          type="button"
          onClick={onNext}
          disabled={!canContinue}
          className="mt-6 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {t('continue')}
        </button>
      </div>
    </WizardShell>
  );
}
