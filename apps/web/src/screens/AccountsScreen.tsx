import { useI18n } from '../lib/i18n';

// חשבונות (Stage 6 prep, 2026-10-13) — placeholder only, positioned right
// after "בקרת מסעדה" per explicit user request. Real content (billing-history
// Edge Function, payment_events-backed running view per table/session,
// authorize-order-hold) isn't built yet — see Implementation Plan v8, Stage 6.
// Same "honest skeleton" convention already used for ServiceScreen's own
// "אי-התאמות" sub-tab, not a stand-in for real functionality.
export function AccountsScreen() {
  const { t } = useI18n();
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-lg font-bold text-ink">{t('accountsTitle')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('accountsSubtitle')}</p>
      <div className="rounded bg-surface-2 px-4 py-8 text-center">
        <p className="mb-1 text-sm font-semibold text-ink">{t('accountsComingSoonTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('accountsComingSoonMessage')}</p>
      </div>
    </div>
  );
}
