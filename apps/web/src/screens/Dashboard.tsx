import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <p className="mb-2 text-sm text-gray-500">{t('signedInAs')}</p>
      <p className="mb-1 text-lg font-semibold text-gray-900">{email}</p>
      <p className="mb-2 text-base text-gray-800">{restaurant.name}</p>
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
  );
}
