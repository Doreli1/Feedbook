import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';
import { WizardShell } from '../components/WizardShell';
import { TrashIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

type SaveState = 'idle' | 'incomplete' | 'saving' | 'saved' | 'error';

interface Props {
  session: Session;
  restaurant: Restaurant | null;
  // Optional: this screen is never reached with restaurant === null outside
  // the wizard's own step 1, so an edit-from-Dashboard visit (always an
  // existing, already-approved restaurant) never actually calls this.
  onCreated?: (id: string) => void;
  // Fired after every successful save, create or update — lets the parent
  // refetch its own restaurant list so a later remount of this screen (step
  // bar navigation, or leaving and returning) doesn't read a stale cached
  // copy missing what was just saved. onCreated alone isn't enough: it only
  // fires for a brand-new restaurant's first save, never for an update to
  // one that already exists.
  onSaved?: () => void;
  onNext: () => void;
  // Overrides the primary button's label (default t('continue')) — for
  // reuse outside the wizard sequence, editing an already-approved
  // restaurant's details from the Dashboard, where "continue" (implying a
  // next wizard step) doesn't apply; onNext there just returns to Dashboard.
  primaryLabel?: string;
  // Free step-bar navigation (any step, not just completed ones). Wrapped
  // below to flush the pending debounced autosave first — without that, a
  // click within the 1200ms debounce window would navigate away before the
  // last few keystrokes were ever sent.
  onStepClick?: (step: number) => void;
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

// Sunday=0 .. Saturday=6, matching the Israeli week convention used
// throughout this project's content (e.g. "א'-ה'" for Sun-Thu).
const DAY_KEYS: TranslationKey[] = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'];

interface HourRule {
  key: string; // client-only React list key, never persisted
  fromDay: string; // '' | '0'..'6'
  toDay: string;
  open: string; // 'HH:MM' or ''
  close: string;
}

let ruleKeySeq = 0;
function newRule(): HourRule {
  ruleKeySeq += 1;
  return { key: `rule-${ruleKeySeq}`, fromDay: '', toDay: '', open: '', close: '' };
}

interface StoredHourRule {
  fromDay: number;
  toDay: number;
  open: string;
  close: string;
}

// restaurant.hours is jsonb; the shape is our own convention, not a DB
// constraint. An old value from before this structured picker existed
// (the free-text {text} shape) has none of these fields — parses to no
// rules rather than guessing at a conversion.
function parseHours(stored: unknown): HourRule[] {
  const rules = (stored as { rules?: StoredHourRule[] } | null)?.rules;
  if (!rules?.length) return [];
  return rules.map((r) => {
    ruleKeySeq += 1;
    return { key: `rule-${ruleKeySeq}`, fromDay: String(r.fromDay), toDay: String(r.toDay), open: r.open, close: r.close };
  });
}

function isRuleComplete(rule: HourRule): boolean {
  return rule.fromDay !== '' && rule.toDay !== '' && rule.open !== '' && rule.close !== '';
}

// AFD §3.7.1 screen 2: "פרטי מסעדה בסיסיים" — name, address, phone, hours,
// auto-saved as a draft at every step (DoD: no data loss on refresh/disconnect).
export function RestaurantDetailsForm({ session, restaurant, onCreated, onSaved, onNext, primaryLabel, onStepClick }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(restaurant?.name ?? '');
  const [address, setAddress] = useState(restaurant?.address ?? '');
  const [phonePrefix, setPhonePrefix] = useState(() => parsePhone(restaurant?.phone ?? null).prefix);
  const [phoneNumber, setPhoneNumber] = useState(() => parsePhone(restaurant?.phone ?? null).number);
  const [hourRules, setHourRules] = useState<HourRule[]>(() => parseHours(restaurant?.hours ?? null));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const restaurantId = restaurant?.id ?? null;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPhoneValid = phonePrefix !== '' && /^\d{7}$/.test(phoneNumber);
  const phone = isPhoneValid ? `${phonePrefix}-${phoneNumber}` : '';
  const hasRequiredFields = name.trim() !== '' && address.trim() !== '' && isPhoneValid;

  const completeRules = hourRules.filter(isRuleComplete);
  const dayLabel = (dayIndex: string) => t(DAY_KEYS[Number(dayIndex)] ?? 'daySun');
  const formattedHours = completeRules.map((r) => {
    const days = r.fromDay === r.toDay ? dayLabel(r.fromDay) : `${dayLabel(r.fromDay)}-${dayLabel(r.toDay)}`;
    return `${days} ${r.open}-${r.close}`;
  });

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
  }, [name, address, phone, hourRules]);

  function handleStepClick(target: number) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      if (hasRequiredFields) void save();
    }
    onStepClick?.(target);
  }

  // Same flush as handleStepClick, but awaited: "continue" unmounts this
  // screen immediately after, so a fire-and-forget save here would race the
  // unmount and could get cancelled by the debounce effect's own cleanup.
  async function handleContinue() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      if (hasRequiredFields) await save();
    }
    onNext();
  }

  function updateRule(key: string, patch: Partial<HourRule>) {
    setHourRules((rules) => rules.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRule(key: string) {
    setHourRules((rules) => rules.filter((r) => r.key !== key));
  }

  async function save() {
    setSaveState('saving');
    setErrorMessage(null);

    const hours = {
      rules: completeRules.map((r) => ({
        fromDay: Number(r.fromDay),
        toDay: Number(r.toDay),
        open: r.open,
        close: r.close,
      })),
    };

    if (!restaurantId) {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-restaurant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, address, phone, hours, kosher_status: 'not_certified' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(body?.error?.message ?? 'Save failed, will retry automatically');
        setSaveState('error');
        return;
      }
      setSaveState('saved');
      onCreated?.(body.restaurant.id);
      onSaved?.();
      return;
    }

    const { error } = await supabase.from('restaurants').update({ name, address, phone, hours }).eq('id', restaurantId);

    if (error) {
      setErrorMessage(error.message);
      setSaveState('error');
      return;
    }
    setSaveState('saved');
    onSaved?.();
  }

  return (
    <WizardShell
      restaurantName={restaurant?.name}
      restaurantAddress={restaurant?.address ?? undefined}
      currentStep={1}
      hideStepper={!!primaryLabel}
      onStepClick={onStepClick && handleStepClick}
    >
      <div className="card p-8">
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
        <div className="mb-2 space-y-2">
          {hourRules.map((rule) => (
            <div key={rule.key} className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-surface-2 p-2">
              <span className="text-xs text-muted-foreground">{t('hoursDaysFrom')}</span>
              <select
                value={rule.fromDay}
                onChange={(e) => updateRule(rule.key, { fromDay: e.target.value })}
                className="rounded border border-border px-1.5 py-1 text-xs"
              >
                <option value="" />
                {DAY_KEYS.map((key, i) => (
                  <option key={key} value={i}>
                    {t(key)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">{t('hoursDaysTo')}</span>
              <select
                value={rule.toDay}
                onChange={(e) => updateRule(rule.key, { toDay: e.target.value })}
                className="rounded border border-border px-1.5 py-1 text-xs"
              >
                <option value="" />
                {DAY_KEYS.map((key, i) => (
                  <option key={key} value={i}>
                    {t(key)}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={rule.open}
                onChange={(e) => updateRule(rule.key, { open: e.target.value })}
                className="rounded border border-border px-1.5 py-1 text-xs"
              />
              <span className="text-xs text-muted-foreground">{t('hoursDaysTo')}</span>
              <input
                type="time"
                value={rule.close}
                onChange={(e) => updateRule(rule.key, { close: e.target.value })}
                className="rounded border border-border px-1.5 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => removeRule(rule.key)}
                title={t('hoursRemoveRange')}
                aria-label={t('hoursRemoveRange')}
                className="ms-auto shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setHourRules((rules) => [...rules, newRule()])}
          className="mb-3 w-full rounded border border-dashed border-border-strong py-1.5 text-xs text-accent hover:bg-accent-soft"
        >
          {t('hoursAddRange')}
        </button>

        {formattedHours.length > 0 && (
          <p dir="auto" className="mb-4 rounded bg-accent-soft px-3 py-2 text-xs text-ink-soft">
            {formattedHours.join(', ')}
          </p>
        )}

        <div className="mb-4 min-h-5 text-xs">
          {saveState === 'incomplete' && <span className="text-muted-foreground">{t('fillRequiredFields')}</span>}
          {saveState === 'saving' && <span className="text-muted-foreground">{t('saving')}</span>}
          {saveState === 'saved' && <span className="text-success">{t('savedAsDraft')}</span>}
          {saveState === 'error' && <span className="text-danger">{errorMessage}</span>}
        </div>

        <button
          onClick={() => void handleContinue()}
          disabled={!restaurantId}
          className="mb-3 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {primaryLabel ?? t('continue')}
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
