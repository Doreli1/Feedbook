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

interface Props {
  email: string | undefined;
  restaurant: Restaurant;
  restaurants: Restaurant[];
  onSwitchRestaurant: (id: string) => void;
  onAddRestaurant: () => void;
  onEditDetails: () => void;
}

export function Dashboard({ email, restaurant, restaurants, onSwitchRestaurant, onAddRestaurant, onEditDetails }: Props) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background px-6 py-4">
      <AppHeader
        restaurantName={restaurant.name}
        restaurantAddress={restaurant.address ?? undefined}
        restaurants={restaurants}
        activeRestaurantId={restaurant.id}
        onSwitchRestaurant={onSwitchRestaurant}
        onAddRestaurant={onAddRestaurant}
      />
      <div className="flex flex-col items-center justify-center py-16">
        <p className="mb-2 text-sm text-muted-foreground">{t('signedInAs')}</p>
        <p className="mb-1 text-lg font-semibold text-ink">{email}</p>
        <p className="mb-6 text-xs text-muted-foreground">
          {t(STATUS_KEYS[restaurant.onboarding_status] ?? 'statusDraft')}
        </p>
        {restaurant.onboarding_status !== 'approved' && (
          <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">{t('dashboardComingSoon')}</p>
        )}
        <button
          onClick={onEditDetails}
          className="mb-3 rounded border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2"
        >
          {t('editRestaurantDetails')}
        </button>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="rounded border border-danger px-4 py-2 text-sm text-danger hover:bg-danger-soft"
        >
          {t('signOut')}
        </button>
      </div>
    </div>
  );
}
