import type { Restaurant } from '@feedbook/types';
import { FeedbookBrand } from './FeedbookBrand';
import { LanguageToggle } from './LanguageToggle';
import { useI18n } from '../lib/i18n';

interface Props {
  restaurantName?: string;
  restaurantAddress?: string;
  // Multi-restaurant switcher (Dashboard only — see AuthenticatedRouter in
  // App.tsx). Omitted everywhere else, where a single restaurant's name is
  // shown as plain text via restaurantName/restaurantAddress instead.
  restaurants?: Restaurant[];
  activeRestaurantId?: string;
  onSwitchRestaurant?: (id: string) => void;
  onAddRestaurant?: () => void;
}

// Shared top bar for every authenticated/registration screen: Feedbook brand
// always on the left (forced dir="ltr" on the row — see FeedbookBrand, which
// otherwise jumps to the right under RTL), business name (+ address on a
// second line, Booking extranet-style) and language toggle on the right.
// restaurantName/Address are omitted on screens reached before a restaurant
// row exists yet (sign-in, MFA, step 1 before the first save).
export function AppHeader({
  restaurantName,
  restaurantAddress,
  restaurants,
  activeRestaurantId,
  onSwitchRestaurant,
  onAddRestaurant,
}: Props) {
  const { t } = useI18n();
  const showSwitcher = restaurants && restaurants.length > 1 && onSwitchRestaurant;

  return (
    <div dir="ltr" className="mb-4 flex items-center justify-between gap-3">
      <FeedbookBrand />
      <div className="flex min-w-0 items-center gap-3">
        {showSwitcher ? (
          <select
            dir="auto"
            value={activeRestaurantId}
            onChange={(e) => onSwitchRestaurant(e.target.value)}
            className="max-w-[200px] truncate rounded border border-border bg-transparent py-1 text-sm font-medium text-ink"
          >
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          restaurantName && (
            <div dir="auto" className="max-w-[200px] text-right">
              <p className="truncate text-sm font-medium text-ink">{restaurantName}</p>
              {restaurantAddress && <p className="truncate text-xs text-muted-foreground">{restaurantAddress}</p>}
            </div>
          )
        )}
        {onAddRestaurant && (
          <button
            type="button"
            onClick={onAddRestaurant}
            className="whitespace-nowrap text-xs font-medium text-accent hover:underline"
          >
            {t('addRestaurant')}
          </button>
        )}
        <LanguageToggle placement="bottom" />
      </div>
    </div>
  );
}
