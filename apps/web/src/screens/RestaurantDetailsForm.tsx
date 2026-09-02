import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';
import { WizardStepper } from '../components/WizardStepper';
import { AppHeader } from '../components/AppHeader';
import { useI18n } from '../lib/i18n';

type SaveState = 'idle' | 'incomplete' | 'saving' | 'saved' | 'error';

interface Props {
  session: Session;
  restaurant: Restaurant | null;
  onCreated: () => void;
  onNext: () => void;
}

// AFD §3.7.1 screen 2: "פרטי מסעדה בסיסיים" — name, address, phone, hours,
// auto-saved as a draft at every step (DoD: no data loss on refresh/disconnect).
export function RestaurantDetailsForm({ session, restaurant, onCreated, onNext }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(restaurant?.name ?? '');
  const [address, setAddress] = useState(restaurant?.address ?? '');
  const [phone, setPhone] = useState(restaurant?.phone ?? '');
  const [hours, setHours] = useState(() => {
    const h = restaurant?.hours as { text?: string } | null;
    return h?.text ?? '';
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const restaurantId = restaurant?.id ?? null;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasRequiredFields = name.trim() !== '' && address.trim() !== '' && phone.trim() !== '';

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!hasRequiredFields) {
      setSaveState('incomplete');
      return;
    }

    debounceRef.current = setTimeout(() => {
      void save();
    }, 1200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, address, phone, hours]);

  async function save() {
    setSaveState('saving');
    setErrorMessage(null);

    if (!restaurantId) {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-restaurant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          address,
          phone,
          hours: { text: hours },
          kosher_status: 'not_certified',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErrorMessage(body?.error?.message ?? 'Save failed, will retry automatically');
        setSaveState('error');
        return;
      }
      setSaveState('saved');
      onCreated();
      return;
    }

    const { error } = await supabase
      .from('restaurants')
      .update({ name, address, phone, hours: { text: hours } })
      .eq('id', restaurantId);

    if (error) {
      setErrorMessage(error.message);
      setSaveState('error');
      return;
    }
    setSaveState('saved');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <AppHeader restaurantName={restaurant?.name} />
        {/* This is step 1 of the numbered wizard — nothing precedes it, so
            there's no onStepClick target yet. Going back to sign-in is only
            via the sign-out button below. */}
        <WizardStepper currentStep={1} />
        <h1 className="mb-1 text-xl font-bold text-blue-900">{t('restaurantDetailsTitle')}</h1>
        <p className="mb-6 text-sm text-gray-500">{t('restaurantDetailsSubtitle')}</p>

        <label className="mb-1 block text-xs font-semibold text-gray-500">{t('restaurantName')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-500">{t('address')}</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-500">{t('phone')}</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-500">{t('hours')}</label>
        <input
          type="text"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder={t('hoursPlaceholder')}
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <div className="mb-4 min-h-5 text-xs">
          {saveState === 'incomplete' && <span className="text-gray-400">{t('fillRequiredFields')}</span>}
          {saveState === 'saving' && <span className="text-gray-400">{t('saving')}</span>}
          {saveState === 'saved' && <span className="text-green-600">{t('savedAsDraft')}</span>}
          {saveState === 'error' && <span className="text-red-600">{errorMessage}</span>}
        </div>

        <button
          onClick={onNext}
          disabled={!restaurantId}
          className="mb-3 w-full rounded bg-blue-700 py-2 text-sm font-medium text-white disabled:bg-gray-300 disabled:text-gray-500"
        >
          {t('continue')}
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
