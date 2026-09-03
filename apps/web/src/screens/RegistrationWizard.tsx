import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { RestaurantDetailsForm } from './RestaurantDetailsForm';
import { KosherStatusForm } from './KosherStatusForm';
import { MenuBuilderForm } from './MenuBuilderForm';
import { TableManagerForm } from './TableManagerForm';
import { WizardShell } from '../components/WizardShell';
import { useI18n } from '../lib/i18n';
import { useMenu } from '../lib/useMenu';
import { useTables } from '../lib/useTables';
import { supabase } from '../lib/supabase';

interface Props {
  session: Session;
  restaurant: Restaurant | null;
  onRefresh: () => void;
  // Fired once, right when a brand-new restaurant row is first created at
  // step 1 — lets the caller make it the active restaurant immediately
  // (relevant when adding an additional restaurant to an account that
  // already has one; irrelevant, and safe to omit, for a first-ever signup).
  onCreated?: (id: string) => void;
}

// AFD §3.7.1 — screens 1 (פרטי מסעדה), 2 (כשרות), and "הגדרת המסעדה" (תפריט
// + הושבה, steps 3-4 here) of the numbered wizard are built; pricing,
// agreement, and review don't exist yet. `step` is local component state,
// not persisted server-side — returning users always re-land on step 1 with
// their data already filled in and click through again, which loses no
// data (AFD §3.7.2 DoD), just a couple of clicks.
//
// 3 and 4 are sub-steps of the SAME parent stepper segment
// ("stepRestaurantSetup") — see WizardStepper's STEP_KEYS comment.
type Step = 1 | 2 | 3 | 4 | 'more-to-come';

// Every screen's step-bar is clickable for free navigation (any step, not
// just completed ones) — each screen's own save logic is what guarantees
// nothing typed is lost on the way out (RestaurantDetailsForm flushes its
// debounced autosave before calling this; Kosher/Menu/Seating already save
// each item immediately on its own explicit action, so there's nothing
// in-flight to flush there). Clicking the setup parent segment itself
// (not one of its two split sub-bars) lands on menu, the first sub-step.
//
// n is WizardStepper's own segment number (1-4, matching its 4 STEP_KEYS:
// details/kosher/setup/review) — NOT the same numbering as this file's Step
// type, where 3 and 4 are the setup parent's two sub-steps and there's a
// 5th, string-valued state ('more-to-come') for what the stepper displays
// as segment 4 ("review"). Segment 4 therefore maps to 'more-to-come', not
// to the Step value 4 (which is seating, reachable only via onSubStepClick).
function toStep(n: number): Step {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 'more-to-come';
}

export function RegistrationWizard({ session, restaurant, onRefresh, onCreated }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const goToStep = (n: number) => setStep(toStep(n));
  const needsMenu = step === 3 || step === 4;
  const { categories, dishes, refresh: refreshMenu } = useMenu(needsMenu ? restaurant?.id : undefined);
  const { tables, refresh: refreshTables } = useTables(step === 4 ? restaurant?.id : undefined);

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
      />
    );
  }

  if (step === 3) {
    return (
      <MenuBuilderForm
        restaurant={restaurant}
        categories={categories}
        dishes={dishes}
        onRefresh={() => void refreshMenu()}
        onNext={() => setStep(4)}
        onSeating={() => setStep(4)}
        onStepClick={goToStep}
      />
    );
  }

  if (step === 4) {
    return (
      <TableManagerForm
        restaurant={restaurant}
        tables={tables}
        onRefresh={() => void refreshTables()}
        onBack={() => setStep(3)}
        onNext={() => setStep('more-to-come')}
        onStepClick={goToStep}
      />
    );
  }

  // TODO(review screen): free step-bar navigation (goToStep, above) means a
  // user can click straight here without ever completing kosher/menu/tables
  // — there's no submission yet to block, so it's a non-issue today, but
  // whatever replaces this placeholder MUST validate real completeness
  // (menu's own >=1-category/>=1-dish minimum, at least) before allowing
  // final submission — not just rely on having reached this screen. Flagged
  // per direct product decision 2026-09-02: keep free navigation, add that
  // check when this screen is actually built. See also AFD §3.7.1 screen 7.
  return (
    <WizardShell
      restaurantName={restaurant?.name}
      restaurantAddress={restaurant?.address ?? undefined}
      currentStep={4}
      onStepClick={goToStep}
    >
      <div className="card p-8">
        <p className="mb-4 rounded border-l-4 border-accent bg-accent-soft px-3 py-2 text-sm text-ink-soft">
          {t('wizardInProgressNote')}
        </p>
        <button
          onClick={() => setStep(4)}
          className="mb-3 w-full rounded border border-border py-2 text-sm text-muted-foreground hover:bg-surface-2"
        >
          {t('back')}
        </button>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="w-full rounded border border-danger py-2 text-sm text-danger hover:bg-danger-soft"
        >
          {t('signOut')}
        </button>
      </div>
    </WizardShell>
  );
}
