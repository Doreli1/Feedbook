import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';
import { AppHeader } from '../components/AppHeader';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

const STATUS_KEYS: Record<string, TranslationKey> = {
  draft: 'statusDraft',
  pending_review: 'statusPendingReview',
  approved: 'statusApproved',
  rejected: 'statusRejected',
};

export function Dashboard({ email, restaurant }: { email: string | undefined; restaurant: Restaurant }) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-gray-50 px-6 py-4">
      <AppHeader restaurantName={restaurant.name} restaurantAddress={restaurant.address ?? undefined} />
      <div className="flex flex-col items-center justify-center py-16">
        <p className="mb-2 text-sm text-gray-500">{t('signedInAs')}</p>
        <p className="mb-1 text-lg font-semibold text-gray-900">{email}</p>
        <p className="mb-6 text-xs text-gray-400">
          {t(STATUS_KEYS[restaurant.onboarding_status] ?? 'statusDraft')}
        </p>
        {restaurant.onboarding_status !== 'approved' && (
          <p className="mb-6 max-w-sm text-center text-sm text-gray-400">{t('dashboardComingSoon')}</p>
        )}
        <button
          onClick={() => void supabase.auth.signOut()}
          className="rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          {t('signOut')}
        </button>
      </div>
    </div>
  );
}
