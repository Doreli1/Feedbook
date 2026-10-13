import { useI18n } from '../lib/i18n';

// חוות דעת (Stage 7 prep, 2026-10-13) — placeholder only, positioned right
// after "אי-התאמות ושירות" per explicit user request. Depends on Stage 6
// (the real review trigger is a completed payment, not just a closed
// account) — see Implementation Plan v8, Stage 7. Same "honest skeleton"
// convention already used for ServiceScreen's own "אי-התאמות" sub-tab.
export function ReviewsScreen() {
  const { t } = useI18n();
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-lg font-bold text-ink">{t('reviewsTitle')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('reviewsSubtitle')}</p>
      <div className="rounded bg-surface-2 px-4 py-8 text-center">
        <p className="mb-1 text-sm font-semibold text-ink">{t('reviewsComingSoonTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('reviewsComingSoonMessage')}</p>
      </div>
    </div>
  );
}
