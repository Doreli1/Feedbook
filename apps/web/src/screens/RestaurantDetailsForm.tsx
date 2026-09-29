import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';
import { WizardShell } from '../components/WizardShell';
import { Tooltip } from '../components/Tooltip';
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
  // Lets the Feedbook logo exit the wizard back to the Dashboard — only
  // passed when adding an additional restaurant to an account that already
  // has one; never for a first-ever signup or the Dashboard edit-details
  // reuse of this same screen (see App.tsx / RegistrationWizard.tsx).
  onExit?: () => void;
}

// Israeli mobile prefixes only — this is a mobile-contact field (matches the
// hours field's own "call the restaurant" purpose), not a general phone
// field, so landline area codes (02/03/04/etc.) are deliberately excluded.
const MOBILE_PREFIXES = ['050', '051', '052', '053', '054', '055', '058'];

// Matches the restaurants.cuisine_tags CHECK constraint's valid-values list
// exactly (20260910120000_restaurant_profile_fields.sql) — keep in sync if
// a tag is ever added there.
const CUISINE_TAG_KEYS: Record<string, TranslationKey> = {
  dairy: 'cuisineDairy',
  meat: 'cuisineMeat',
  fish: 'cuisineFish',
  asian: 'cuisineAsian',
};

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
export function RestaurantDetailsForm({ session, restaurant, onCreated, onSaved, onNext, primaryLabel, onStepClick, onExit }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(restaurant?.name ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState(restaurant?.logo_url ?? null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState(restaurant?.description ?? '');
  const [cuisineTags, setCuisineTags] = useState<string[]>(restaurant?.cuisine_tags ?? []);
  const [address, setAddress] = useState(restaurant?.address ?? '');
  const [phonePrefix, setPhonePrefix] = useState(() => parsePhone(restaurant?.phone ?? null).prefix);
  const [phoneNumber, setPhoneNumber] = useState(() => parsePhone(restaurant?.phone ?? null).number);
  const [hourRules, setHourRules] = useState<HourRule[]>(() => parseHours(restaurant?.hours ?? null));
  const [cancellationWindow, setCancellationWindow] = useState(
    restaurant?.cancellation_window_minutes != null ? String(restaurant.cancellation_window_minutes) : '',
  );
  const [vatRate, setVatRate] = useState(restaurant ? String(restaurant.vat_rate_percent) : '18');
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
  }, [name, address, phone, hourRules, logoFile, description, cuisineTags, cancellationWindow, vatRate]);

  function handleStepClick(target: number) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      if (hasRequiredFields) void save();
    }
    onStepClick?.(target);
  }

  function handleExit() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      if (hasRequiredFields) void save();
    }
    onExit?.();
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

  const isCertified = restaurant?.kosher_status === 'certified';

  // Proactive UI guard in front of the real DB constraint
  // (cuisine_tags_kosher_exclusive) — a certified restaurant can pick only
  // one of dairy/meat, confirmed directly with the product owner
  // (2026-09-10). Fish/asian/etc. are never restricted by this.
  function toggleCuisineTag(tag: string) {
    setCuisineTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (isCertified && (tag === 'dairy' || tag === 'meat')) {
        const other = tag === 'dairy' ? 'meat' : 'dairy';
        return [...prev.filter((t) => t !== other), tag];
      }
      return [...prev, tag];
    });
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

    // Keep the existing logo untouched unless a new file was chosen — same
    // "only touch what changed" approach already used for dish photos.
    let nextLogoUrl = logoUrl;
    if (logoFile) {
      const ext = logoFile.name.split('.').pop() ?? 'jpg';
      const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('restaurant-logos')
        .upload(path, logoFile, { contentType: logoFile.type });
      if (uploadError) {
        setErrorMessage(uploadError.message);
        setSaveState('error');
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('restaurant-logos').getPublicUrl(path);
      nextLogoUrl = publicUrlData.publicUrl;
    }

    const { error } = await supabase
      .from('restaurants')
      .update({
        name,
        address,
        phone,
        hours,
        logo_url: nextLogoUrl,
        description: description.trim() || null,
        cuisine_tags: cuisineTags,
        cancellation_window_minutes: cancellationWindow.trim() === '' ? null : Number(cancellationWindow),
        vat_rate_percent: vatRate.trim() === '' ? 18 : Number(vatRate),
      })
      .eq('id', restaurantId);

    if (error) {
      setErrorMessage(error.message);
      setSaveState('error');
      return;
    }
    setLogoUrl(nextLogoUrl);
    setLogoFile(null);
    setSaveState('saved');
    onSaved?.();
  }

  return (
    <WizardShell
      restaurantName={restaurant?.name}
      restaurantAddress={restaurant?.address ?? undefined}
      userEmail={session.user.email}
      onSignOut={() => void supabase.auth.signOut()}
      currentStep={1}
      hideStepper={!!primaryLabel}
      onStepClick={onStepClick && handleStepClick}
      onExit={onExit && handleExit}
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

        {restaurantId && (
          <div className="mb-3">
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('restaurantLogo')}</label>
            <div className="flex items-center gap-3">
              {logoFile || logoUrl ? (
                <img
                  src={logoFile ? URL.createObjectURL(logoFile) : (logoUrl as string)}
                  alt=""
                  className="h-12 w-12 rounded-full border border-border object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-full border border-border bg-surface-2" />
              )}
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent-soft"
              >
                {logoUrl || logoFile ? t('logoReplace') : t('logoUpload')}
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{t('logoHelp')}</p>
          </div>
        )}

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('restaurantDescription')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder={t('restaurantDescriptionPlaceholder')}
          className="mb-3 w-full resize-y rounded border border-border px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('cuisineTags')}</label>
        <div className="mb-1 flex flex-wrap gap-2">
          {Object.entries(CUISINE_TAG_KEYS).map(([tag, key]) => {
            const selected = cuisineTags.includes(tag);
            const otherDairyMeat = tag === 'dairy' ? 'meat' : tag === 'meat' ? 'dairy' : null;
            const disabled = !selected && isCertified && !!otherDairyMeat && cuisineTags.includes(otherDairyMeat);
            return (
              <button
                key={tag}
                type="button"
                disabled={disabled}
                onClick={() => toggleCuisineTag(tag)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  selected
                    ? 'border-accent bg-accent-soft text-accent'
                    : disabled
                      ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                      : 'border-border text-ink hover:bg-surface-2'
                }`}
              >
                {t(key)}
              </button>
            );
          })}
        </div>
        {isCertified && (
          <p className="mb-3 text-[10px] text-muted-foreground">{t('cuisineKosherExclusiveHint')}</p>
        )}
        {!isCertified && <div className="mb-3" />}

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
                  <option key={key} value={i} disabled={isCertified && i === 6}>
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
                  <option key={key} value={i} disabled={isCertified && i === 6}>
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
              <Tooltip content={t('hoursRemoveRange')} className="ms-auto">
                <button
                  type="button"
                  onClick={() => removeRule(rule.key)}
                  aria-label={t('hoursRemoveRange')}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
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
        {isCertified && (
          <p className="mb-3 text-[10px] text-muted-foreground">{t('hoursKosherClosedSaturdayHint')}</p>
        )}

        {formattedHours.length > 0 && (
          <p dir="auto" className="mb-4 rounded bg-accent-soft px-3 py-2 text-xs text-ink-soft">
            {formattedHours.join(', ')}
          </p>
        )}

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('cancellationWindow')}</label>
        <div className="mb-1 flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={cancellationWindow}
            onChange={(e) => setCancellationWindow(e.target.value.replace(/\D/g, ''))}
            placeholder="10"
            className="w-24 rounded border border-border px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">{t('cancellationWindowUnit')}</span>
        </div>
        <p className="mb-4 text-[10px] text-muted-foreground">{t('cancellationWindowHelp')}</p>

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('vatRateLabel')}</label>
        <div className="mb-1 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            placeholder="18"
            className="w-24 rounded border border-border px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <p className="mb-4 text-[10px] text-muted-foreground">{t('vatRateHelp')}</p>

        <div className="mb-4 min-h-5 text-xs">
          {saveState === 'incomplete' && <span className="text-muted-foreground">{t('fillRequiredFields')}</span>}
          {saveState === 'saving' && <span className="text-muted-foreground">{t('saving')}</span>}
          {saveState === 'saved' && <span className="text-success">{t('savedAsDraft')}</span>}
          {saveState === 'error' && <span className="text-danger">{errorMessage}</span>}
        </div>

        <button
          onClick={() => void handleContinue()}
          disabled={!restaurantId}
          className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {primaryLabel ?? t('continue')}
        </button>
      </div>
    </WizardShell>
  );
}
