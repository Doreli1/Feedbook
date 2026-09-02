import { FeedbookBrand } from './FeedbookBrand';
import { LanguageToggle } from './LanguageToggle';

interface Props {
  restaurantName?: string;
  restaurantAddress?: string;
}

// Shared top bar for every authenticated/registration screen: Feedbook brand
// always on the left (forced dir="ltr" on the row — see FeedbookBrand, which
// otherwise jumps to the right under RTL), business name (+ address on a
// second line, Booking extranet-style) and language toggle on the right.
// restaurantName/Address are omitted on screens reached before a restaurant
// row exists yet (sign-in, MFA, step 1 before the first save).
export function AppHeader({ restaurantName, restaurantAddress }: Props) {
  return (
    <div dir="ltr" className="mb-4 flex items-center justify-between gap-3">
      <FeedbookBrand />
      <div className="flex min-w-0 items-center gap-3">
        {restaurantName && (
          <div dir="auto" className="max-w-[200px] text-right">
            <p className="truncate text-sm font-medium text-gray-700">{restaurantName}</p>
            {restaurantAddress && <p className="truncate text-xs text-gray-400">{restaurantAddress}</p>}
          </div>
        )}
        <LanguageToggle />
      </div>
    </div>
  );
}
