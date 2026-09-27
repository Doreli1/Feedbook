import { useEffect, useState } from 'react';
import { OVERHEAD_CATEGORIES, type OverheadCategory } from '../lib/useOverheadExpenses';
import type { OverheadExpense } from '@feedbook/types';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

const CATEGORY_LABEL_KEYS: Record<OverheadCategory, TranslationKey> = {
  rent: 'overheadCategoryRent',
  utilities: 'overheadCategoryUtilities',
  labor: 'overheadCategoryLabor',
  insurance: 'overheadCategoryInsurance',
  marketing: 'overheadCategoryMarketing',
  other: 'overheadCategoryOther',
};

interface Props {
  expenses: OverheadExpense[];
  onSave: (amounts: Record<OverheadCategory, number>) => Promise<{ error: { message: string } | null }>;
}

// A fixed 6-field settings form, not a growing expense ledger — matches the
// simple "one number per category, always present" model the migration's
// upsert-on-(restaurant_id, category) constraint is built around.
export function OverheadExpensesForm({ expenses, onSave }: Props) {
  const { t } = useI18n();
  const [amounts, setAmounts] = useState<Record<OverheadCategory, string>>(() => {
    const byCategory = new Map(expenses.map((e) => [e.category, e.monthly_amount]));
    return Object.fromEntries(OVERHEAD_CATEGORIES.map((c) => [c, String(byCategory.get(c) ?? 0)])) as Record<OverheadCategory, string>;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const byCategory = new Map(expenses.map((e) => [e.category, e.monthly_amount]));
    setAmounts(Object.fromEntries(OVERHEAD_CATEGORIES.map((c) => [c, String(byCategory.get(c) ?? 0)])) as Record<OverheadCategory, string>);
    // Only re-sync from freshly-fetched data, not on every local keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses]);

  const total = OVERHEAD_CATEGORIES.reduce((sum, c) => sum + (Number(amounts[c]) || 0), 0);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const parsed = Object.fromEntries(OVERHEAD_CATEGORIES.map((c) => [c, Number(amounts[c]) || 0])) as Record<OverheadCategory, number>;
    const { error: saveError } = await onSave(parsed);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="card p-6">
      <h2 className="mb-1 text-sm font-semibold text-ink">{t('overheadHeading')}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t('overheadSubtitle')}</p>

      {error && (
        <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {OVERHEAD_CATEGORIES.map((category) => (
          <div key={category}>
            <label className="mb-1 block text-xs text-muted-foreground">{t(CATEGORY_LABEL_KEYS[category])}</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-sm text-muted-foreground">₪</span>
              <input
                type="number"
                min="0"
                step="1"
                value={amounts[category]}
                onChange={(e) => {
                  setSaved(false);
                  setAmounts((prev) => ({ ...prev, [category]: e.target.value }));
                }}
                className="w-full rounded border border-border py-1.5 ps-6 pe-2 text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        {t('overheadTotalLabel')}: <span className="font-medium text-ink">₪{total.toFixed(0)}</span> {t('overheadPerMonth')}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('saving') : t('overheadSave')}
        </button>
        {saved && <span className="text-xs text-success">{t('savedAsDraft')}</span>}
      </div>
    </div>
  );
}
