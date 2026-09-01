import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';

const STATUS_LABELS: Record<Restaurant['onboarding_status'], string> = {
  draft: 'טיוטה',
  pending_review: 'ממתין לאישור',
  approved: 'מאושר',
  rejected: 'נדחה',
};

export function Dashboard({ email, restaurant }: { email: string | undefined; restaurant: Restaurant }) {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <p className="mb-2 text-sm text-gray-500">מחובר כ-</p>
      <p className="mb-1 text-lg font-semibold text-gray-900">{email}</p>
      <p className="mb-2 text-base text-gray-800">{restaurant.name}</p>
      <p className="mb-6 text-xs text-gray-400">סטטוס: {STATUS_LABELS[restaurant.onboarding_status]}</p>
      {restaurant.onboarding_status !== 'approved' && (
        <p className="mb-6 max-w-sm text-center text-sm text-gray-400">
          ניהול תפריטים, שולחנות והזמנות עדיין בבנייה — יתווספו כאן בהמשך.
        </p>
      )}
      <button
        onClick={() => void supabase.auth.signOut()}
        className="rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
      >
        התנתקות
      </button>
    </div>
  );
}
