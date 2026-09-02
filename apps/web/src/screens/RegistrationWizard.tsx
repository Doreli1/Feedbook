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

export function RegistrationWizard({ session, restaurant, onRefresh, onCreated }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);
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
        onNext={() => setStep(2)}
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
      />
    );
  }

  return (
    <WizardShell restaurantName={restaurant?.name} restaurantAddress={restaurant?.address ?? undefined} currentStep={4}>
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
