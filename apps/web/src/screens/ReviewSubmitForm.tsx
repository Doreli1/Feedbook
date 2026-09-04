import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Restaurant, MenuCategory, Dish, RestaurantTable } from '@feedbook/types';
import { WizardShell } from '../components/WizardShell';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { MIN_DISHES } from './MenuBuilderForm';

interface Props {
  session: Session;
  restaurant: Restaurant;
  categories: MenuCategory[];
  dishes: Dish[];
  tables: RestaurantTable[];
  onBack: () => void;
  // Fired after a successful submit — restaurants.onboarding_status is now
  // 'pending_review', so the parent's own routing (App.tsx: only renders
  // this wizard while onboarding_status === 'draft') falls through to
  // Dashboard on its own; no separate "submitted" screen needed here.
  onSubmitted: () => void;
  onStepClick?: (step: number) => void;
}

// Same jsonb shape RestaurantDetailsForm's hours picker writes — duplicated
// small formatter rather than exporting cross-screen state/helpers from that
// already-large file for what's a handful of lines.
const DAY_KEYS: TranslationKey[] = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'];
interface StoredHourRule {
  fromDay: number;
  toDay: number;
  open: string;
  close: string;
}
function formatHours(stored: unknown, t: (key: TranslationKey) => string): string[] {
  const rules = (stored as { rules?: StoredHourRule[] } | null)?.rules;
  if (!rules?.length) return [];
  return rules.map((r) => {
    const from = t(DAY_KEYS[r.fromDay] ?? 'daySun');
    const to = t(DAY_KEYS[r.toDay] ?? 'daySun');
    const days = r.fromDay === r.toDay ? from : `${from}-${to}`;
    return `${days} ${r.open}-${r.close}`;
  });
}

// The merchant agreement's real legal text is still with outside counsel
// (2026-09-03) — this version string marks every acceptance recorded under
// the placeholder wording so real ones are never confused with it once the
// final text ships (Backend Schema §2.4, merchant_agreement_acceptances).
const AGREEMENT_VERSION = 'placeholder-pending-legal-v0';

// AFD §3.7.1 screen 5: "סקירה סופית והסכם הצטרפות" — summarizes every step's
// data, blocks submission until the menu's own >=1-category/>=1-dish
// requirement is actually met (free step-bar navigation lets a user reach
// this screen without it), and records the agreement acceptance + the
// draft -> pending_review transition (API Spec §4.3) in one action.
export function ReviewSubmitForm({ session, restaurant, categories, dishes, tables, onBack, onSubmitted, onStepClick }: Props) {
  const { t } = useI18n();
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasBasicDetails = !!restaurant.name && !!restaurant.address && !!restaurant.phone;
  const hasMenu = categories.length > 0 && dishes.length >= MIN_DISHES;
  const canSubmit = hasBasicDetails && hasMenu && agreementChecked && !submitting;

  const formattedHours = formatHours(restaurant.hours, t);
  const tableCount = tables.length;
  const tableTypesPresent = Array.from(new Set(tables.map((table) => table.table_type).filter((type): type is string => !!type)));

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const { error: agreementError } = await supabase.from('merchant_agreement_acceptances').insert({
      restaurant_id: restaurant.id,
      user_id: session.user.id,
      agreement_version: AGREEMENT_VERSION,
    });
    if (agreementError) {
      setError(agreementError.message);
      setSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase
      .from('restaurants')
      .update({ onboarding_status: 'pending_review', submitted_at: new Date().toISOString() })
      .eq('id', restaurant.id);
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    onSubmitted();
  }

  return (
    <WizardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      currentStep={4}
      onStepClick={onStepClick}
    >
      <div className="card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('reviewTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('reviewSubtitle')}</p>

        {error && (
          <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <section className="mb-5 rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('reviewDetailsHeading')}</h2>
          <p className="text-sm text-ink-soft">{restaurant.name}</p>
          <p className="text-sm text-ink-soft">{restaurant.address}</p>
          <p dir="ltr" className="text-right text-sm text-ink-soft">{restaurant.phone}</p>
          {formattedHours.length > 0 ? (
            <p dir="auto" className="mt-1 text-sm text-ink-soft">{formattedHours.join(', ')}</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t('reviewNoHours')}</p>
          )}
        </section>

        <section className="mb-5 rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('reviewKosherHeading')}</h2>
          <p className="text-sm text-ink-soft">
            {restaurant.kosher_status === 'certified' ? t('kosherCertified') : t('kosherNotCertifiedLabel')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('kosherDisclaimer')}</p>
        </section>

        <section className="mb-5 rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('reviewMenuHeading')}</h2>
          {hasMenu ? (
            <p className="text-sm text-ink-soft">
              {t('reviewMenuSummaryPrefix')} {categories.length} · {t('reviewMenuSummaryDishes')} {dishes.length}
            </p>
          ) : (
            <div className="rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              <p className="mb-2">{t('reviewMenuIncomplete')}</p>
              <button type="button" onClick={() => onStepClick?.(3)} className="underline">
                {t('reviewGoToMenu')}
              </button>
            </div>
          )}
        </section>

        <section className="mb-6 rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('reviewTablesHeading')}</h2>
          {tableCount > 0 ? (
            <p className="text-sm text-ink-soft">
              {tableCount} {t('reviewTablesCountSuffix')}
              {tableTypesPresent.length > 0 && ` (${tableTypesPresent.length} ${t('reviewTableTypesSuffix')})`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('reviewNoTables')}</p>
          )}
        </section>

        <section className="mb-6 rounded border border-border bg-surface-2 p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t('reviewAgreementHeading')}</h2>
          <div className="mb-3 rounded border-l-4 border-accent bg-accent-soft px-3 py-2 text-xs text-ink-soft">
            {t('reviewAgreementPlaceholderNote')}
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={agreementChecked}
              onChange={(e) => setAgreementChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            {t('reviewAgreementCheckboxLabel')}
          </label>
        </section>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="mb-3 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {submitting ? t('reviewSubmitting') : t('reviewSubmit')}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded border border-border py-2 text-sm text-muted-foreground hover:bg-surface-2"
        >
          {t('back')}
        </button>
      </div>
    </WizardShell>
  );
}
