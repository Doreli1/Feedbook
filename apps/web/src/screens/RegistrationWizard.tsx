import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { RestaurantDetailsForm } from './RestaurantDetailsForm';
import { KosherStatusForm } from './KosherStatusForm';
import { MenuBuilderForm } from './MenuBuilderForm';
import { TableManagerForm } from './TableManagerForm';
import { ReviewSubmitForm } from './ReviewSubmitForm';
import { useMenu } from '../lib/useMenu';
import { useTables } from '../lib/useTables';
import { useInventory } from '../lib/useInventory';

interface Props {
  session: Session;
  restaurant: Restaurant | null;
  onRefresh: () => void;
  // Fired once, right when a brand-new restaurant row is first created at
  // step 1 — lets the caller make it the active restaurant immediately
  // (relevant when adding an additional restaurant to an account that
  // already has one; irrelevant, and safe to omit, for a first-ever signup).
  onCreated?: (id: string) => void;
  // Lets the Feedbook logo exit back to the Dashboard from any step — only
  // passed by App.tsx when there's a real dashboard to return to (adding an
  // additional restaurant), never for a first-ever signup or a draft
  // restaurant with no completed sibling to fall back on.
  onExit?: () => void;
}

// AFD §3.7.1 — screens 1 (פרטי מסעדה), 2 (כשרות), "הגדרת המסעדה" (תפריט +
// הושבה, steps 3-4 here), and 5 (סקירה סופית והסכם הצטרפות) are built;
// pricing/agreement screens that AFD notes would sit between 4 and 5 don't
// exist yet — blocked on the commission-rate decision, not a code gap.
// `step` is local component state, not persisted server-side — returning
// users always re-land on step 1 with their data already filled in and
// click through again, which loses no data (AFD §3.7.2 DoD), just a couple
// of clicks.
//
// 3 and 4 are sub-steps of the SAME parent stepper segment
// ("stepRestaurantSetup") — see WizardStepper's STEP_KEYS comment.
type Step = 1 | 2 | 3 | 4 | 5;

// Every screen's step-bar is clickable for free navigation (any step, not
// just completed ones) — each screen's own save logic is what guarantees
// nothing typed is lost on the way out (RestaurantDetailsForm flushes its
// debounced autosave before calling this; Kosher/Menu/Seating/Review already
// save each item immediately on its own explicit action, so there's nothing
// in-flight to flush there). Clicking the setup parent segment itself
// (not one of its two split sub-bars) lands on menu, the first sub-step.
//
// n is WizardStepper's own segment number (1-4, matching its 4 STEP_KEYS:
// details/kosher/setup/review) — NOT the same numbering as this file's Step
// type, where 3 and 4 are the setup parent's two sub-steps and 5 is review.
// Segment 4 ("review") therefore maps to Step 5, not the Step value 4
// (which is seating, reachable only via onSubStepClick).
function toStep(n: number): Step {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 5;
}

export function RegistrationWizard({ session, restaurant, onRefresh, onCreated, onExit }: Props) {
  const [step, setStep] = useState<Step>(1);
  const goToStep = (n: number) => setStep(toStep(n));
  const needsMenu = step === 3 || step === 4 || step === 5;
  const { categories, dishes, dishSizeOptions, refresh: refreshMenu } = useMenu(needsMenu ? restaurant?.id : undefined);
  const { tables, refresh: refreshTables } = useTables(step === 4 || step === 5 ? restaurant?.id : undefined);
  const { ingredients } = useInventory(step === 3 ? restaurant?.id : undefined);

  if (step === 1 || !restaurant) {
    return (
      <RestaurantDetailsForm
        session={session}
        restaurant={restaurant}
        onCreated={(id) => {
          onCreated?.(id);
          onRefresh();
        }}
        onSaved={onRefresh}
        onNext={() => setStep(2)}
        onStepClick={restaurant ? goToStep : undefined}
        onExit={onExit}
      />
    );
  }

  if (step === 2) {
    return (
      <KosherStatusForm
        session={session}
        restaurant={restaurant}
        onUpdated={onRefresh}
        onNext={() => setStep(3)}
        onStepClick={goToStep}
        onExit={onExit}
      />
    );
  }

  if (step === 3) {
    return (
      <MenuBuilderForm
        session={session}
        restaurant={restaurant}
        categories={categories}
        dishes={dishes}
        dishSizeOptions={dishSizeOptions}
        ingredients={ingredients}
        onRefresh={() => void refreshMenu()}
        onNext={() => setStep(4)}
        onSeating={() => setStep(4)}
        onStepClick={goToStep}
        onExit={onExit}
      />
    );
  }

  if (step === 4) {
    return (
      <TableManagerForm
        session={session}
        restaurant={restaurant}
        tables={tables}
        onRefresh={() => void refreshTables()}
        onBack={() => setStep(3)}
        onNext={() => setStep(5)}
        onStepClick={goToStep}
        onExit={onExit}
      />
    );
  }

  return (
    <ReviewSubmitForm
      session={session}
      restaurant={restaurant}
      categories={categories}
      dishes={dishes}
      tables={tables}
      onBack={() => setStep(4)}
      onSubmitted={onRefresh}
      onStepClick={goToStep}
      onExit={onExit}
    />
  );
}
