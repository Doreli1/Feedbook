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
  onCreated: (id: string) => void;
  onNext: () => void;
}

// Israeli mobile prefixes only — this is a mobile-contact field (matches the
// hours field's own "call the restaurant" purpose), not a general phone
// field, so landline area codes (02/03/04/etc.) are deliberately excluded.
const MOBILE_PREFIXES = ['050', '051', '052', '053', '054', '055', '058'];

// Splits a stored "050-1234567" value back into its two input fields when
// editing an existing draft. Anything that doesn't match (empty, or a value
// that predates this validation) just leaves both fields blank rather than
// guessing.
function parsePhone(stored: string | null): { prefix: string; number: string } {
  const match = stored?.match(/^(0\d{2})-?(\d{7})$/);
  return match ? { prefix: match[1] ?? '', number: match[2] ?? '' } : { prefix: '', number: '' };
}

// AFD §3.7.1 screen 2: "פרטי מסעדה בסיסיים" — name, address, phone, hours,
// auto-saved as a draft at every step (DoD: no data loss on refresh/disconnect).
export function RestaurantDetailsForm({ session, restaurant, onCreated, onNext }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(restaurant?.name ?? '');
  const [address, setAddress] = useState(restaurant?.address ?? '');
  const [phonePrefix, setPhonePrefix] = useState(() => parsePhone(restaurant?.phone ?? null).prefix);
  const [phoneNumber, setPhoneNumber] = useState(() => parsePhone(restaurant?.phone ?? null).number);
  const [hours, setHours] = useState(() => {
    const h = restaurant?.hours as { text?: string } | null;
    return h?.text ?? '';
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const restaurantId = restaurant?.id ?? null;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPhoneValid = phonePrefix !== '' && /^\d{7}$/.test(phoneNumber);
  const phone = isPhoneValid ? `${phonePrefix}-${phoneNumber}` : '';
  const hasRequiredFields = name.trim() !== '' && address.trim() !== '' && isPhoneValid;

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
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(body?.error?.message ?? 'Save failed, will retry automatically');
        setSaveState('error');
        return;
      }
      setSaveState('saved');
      onCreated(body.restaurant.id);
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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="card w-full max-w-md p-8">
        <AppHeader restaurantName={restaurant?.name} restaurantAddress={restaurant?.address ?? undefined} />
        {/* This is step 1 of the numbered wizard — nothing precedes it, so
            there's no onStepClick target yet. Going back to sign-in is only
            via the sign-out button below. */}
        <WizardStepper currentStep={1} />
        <h1 className="mb-1 text-xl font-bold text-ink">{t('restaurantDetailsTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('restaurantDetailsSubtitle')}</p>

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('restaurantName')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded border border-border px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('address')}</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="mb-3 w-full rounded border border-border px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('phone')}</label>
        <div dir="ltr" className="mb-1 flex gap-2">
          <select
            value={phonePrefix}
            onChange={(e) => setPhonePrefix(e.target.value)}
            className="rounded border border-border px-2 py-2 text-sm"
          >
            <option value="">{t('phonePrefixPlaceholder')}</option>
            {MOBILE_PREFIXES.map((prefix) => (
              <option key={prefix} value={prefix}>
                {prefix}
              </option>
            ))}
          </select>
          <input
            type="tel"
            inputMode="numeric"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 7))}
            placeholder={t('phoneNumberPlaceholder')}
            className="flex-1 rounded border border-border px-3 py-2 text-sm"
          />
        </div>
        {phoneNumber !== '' && !isPhoneValid && (
          <p className="mb-3 text-xs text-danger">{t('phoneInvalid')}</p>
        )}
        {(phoneNumber === '' || isPhoneValid) && <div className="mb-3" />}

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('hours')}</label>
        <input
          type="text"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder={t('hoursPlaceholder')}
          className="mb-4 w-full rounded border border-border px-3 py-2 text-sm"
        />

        <div className="mb-4 min-h-5 text-xs">
          {saveState === 'incomplete' && <span className="text-muted-foreground">{t('fillRequiredFields')}</span>}
          {saveState === 'saving' && <span className="text-muted-foreground">{t('saving')}</span>}
          {saveState === 'saved' && <span className="text-success">{t('savedAsDraft')}</span>}
          {saveState === 'error' && <span className="text-danger">{errorMessage}</span>}
        </div>

        <button
          onClick={onNext}
          disabled={!restaurantId}
          className="mb-3 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {t('continue')}
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
