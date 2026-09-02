import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { RestaurantDetailsForm } from './RestaurantDetailsForm';
import { KosherStatusForm } from './KosherStatusForm';
import { AppHeader } from '../components/AppHeader';
import { WizardStepper } from '../components/WizardStepper';
import { useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';

interface Props {
  session: Session;
  restaurant: Restaurant | null;
  onRefresh: () => void;
}

// AFD §3.7.1 — screens 1 (פרטי מסעדה) and 2 (כשרות) of the numbered wizard
// are built; the rest (menu, review, submit) don't exist yet. `step` is
// local component state, not persisted server-side — returning users always
// re-land on step 1 with their data already filled in and click through
// again, which loses no data (AFD §3.7.2 DoD), just a couple of clicks.
type Step = 1 | 2 | 'more-to-come';

export function RegistrationWizard({ session, restaurant, onRefresh }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);

  if (step === 1 || !restaurant) {
    return (
      <RestaurantDetailsForm
        session={session}
        restaurant={restaurant}
        onCreated={onRefresh}
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
        onNext={() => setStep('more-to-come')}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <AppHeader restaurantName={restaurant?.name} />
        <WizardStepper currentStep={2} />
        <p className="mb-4 rounded border-l-4 border-blue-300 bg-blue-50 px-3 py-2 text-sm text-gray-700">
          {t('wizardInProgressNote')}
        </p>
        <button
          onClick={() => setStep(2)}
          className="mb-3 w-full rounded border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          {t('back')}
        </button>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="w-full rounded border border-red-300 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          {t('signOut')}
        </button>
      </div>
    </div>
  );
}
