import { FeedbookBrand } from './FeedbookBrand';
import { LanguageToggle } from './LanguageToggle';

interface Props {
  restaurantName?: string;
}

// Shared top bar for every authenticated/registration screen: Feedbook brand
// always on the left (forced dir="ltr" on the row — see FeedbookBrand, which
// otherwise jumps to the right under RTL), business name + language toggle
// on the right. restaurantName is omitted on screens reached before a
// restaurant row exists yet (sign-in, MFA, step 1 before the first save).
export function AppHeader({ restaurantName }: Props) {
  return (
    <div dir="ltr" className="mb-4 flex items-center justify-between gap-3">
      <FeedbookBrand />
      <div className="flex min-w-0 items-center gap-3">
        {restaurantName && (
          <span dir="auto" className="max-w-[160px] truncate text-sm font-medium text-gray-700">
            {restaurantName}
          </span>
        )}
        <LanguageToggle />
      </div>
    </div>
  );
}
