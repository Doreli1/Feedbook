import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { RestaurantDetailsForm } from './RestaurantDetailsForm';
import { KosherStatusForm } from './KosherStatusForm';
import { MenuBuilderForm } from './MenuBuilderForm';
import { AppHeader } from '../components/AppHeader';
import { WizardStepper } from '../components/WizardStepper';
import { useI18n } from '../lib/i18n';
import { useMenu } from '../lib/useMenu';
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

// AFD §3.7.1 — screens 1 (פרטי מסעדה), 2 (כשרות) and 4 (תפריט) of the
// numbered wizard are built; pricing/agreement/review don't exist yet.
// `step` is local component state, not persisted server-side — returning
// users always re-land on step 1 with their data already filled in and
// click through again, which loses no data (AFD §3.7.2 DoD), just a couple
// of clicks.
type Step = 1 | 2 | 3 | 'more-to-come';

export function RegistrationWizard({ session, restaurant, onRefresh, onCreated }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const { categories, dishes, refresh: refreshMenu } = useMenu(step === 3 ? restaurant?.id : undefined);

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
        onNext={() => setStep('more-to-come')}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="card w-full max-w-md p-8">
        <AppHeader restaurantName={restaurant?.name} restaurantAddress={restaurant?.address ?? undefined} />
        <WizardStepper currentStep={4} />
        <p className="mb-4 rounded border-l-4 border-accent bg-accent-soft px-3 py-2 text-sm text-ink-soft">
          {t('wizardInProgressNote')}
        </p>
        <button
          onClick={() => setStep(3)}
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
    </div>
  );
}
