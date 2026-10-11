import type { useRouter } from 'expo-router';
import { supabase } from './supabase';
import { extractFunctionErrorCode } from './functionError';
import type { TranslationKey } from './translations';

type Router = ReturnType<typeof useRouter>;

export interface ScanQrResponse {
  restaurant: {
    id: string;
    name: string;
    logo_url: string | null;
    description: string | null;
    cuisine_tags: string[];
    cancellation_window_minutes: number | null;
    address: string | null;
    phone: string | null;
    hours: unknown;
    kosher_status: string;
    kosher_certificate_url: string | null;
  };
  table: { id: string; table_number: string; smoking_allowed: boolean; table_type: string | null };
  session: { id: string; session_account_number: string; status: string };
}

// Shared by scan-qr.tsx (in-app camera scan) and table/[token].tsx (the
// deep-link route expo-router matches for `feedbook://table/<token>`, tapped
// from outside the app — e.g. a phone's own camera app) — both are "I now
// have a qr_token, resolve it" and must behave identically from here on.
export async function resolveTableToken(
  qrToken: string,
  router: Router,
  options?: { navigate?: 'push' | 'replace' },
): Promise<{ ok: true } | { ok: false; messageKey: TranslationKey }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { ok: false, messageKey: 'qrSessionExpired' };
  }

  const { data, error } = await supabase.functions.invoke<ScanQrResponse>('scan-qr', {
    body: { qr_token: qrToken },
  });

  if (error || !data) {
    const code = await extractFunctionErrorCode(error);
    return {
      ok: false,
      messageKey: code === 'TABLE_NOT_ACTIVE' ? 'tableNotActive' : 'invalidQrCode',
    };
  }

  router[options?.navigate ?? 'replace']({
    pathname: '/restaurant-details',
    params: {
      restaurantId: data.restaurant.id,
      restaurantName: data.restaurant.name,
      restaurantLogoUrl: data.restaurant.logo_url ?? '',
      restaurantDescription: data.restaurant.description ?? '',
      cuisineTags: JSON.stringify(data.restaurant.cuisine_tags ?? []),
      cancellationWindowMinutes: data.restaurant.cancellation_window_minutes?.toString() ?? '',
      restaurantAddress: data.restaurant.address ?? '',
      restaurantPhone: data.restaurant.phone ?? '',
      restaurantHours: JSON.stringify(data.restaurant.hours ?? null),
      kosherStatus: data.restaurant.kosher_status,
      kosherCertificateUrl: data.restaurant.kosher_certificate_url ?? '',
      tableId: data.table.id,
      tableNumber: data.table.table_number,
      // Carried through to add-participants.tsx so it can store it — used to
      // hide the "הזמינו שירות" trigger for bar seating (2026-10-11): real
      // restaurants treat the bar as the bar staff's own responsibility, not
      // the floor waiters', and there is no dedicated bar staff role in the
      // system yet (staff.role is manager/waiter/kitchen only) for a bar
      // call to even be resolvable by the right person.
      tableType: data.table.table_type ?? '',
      sessionId: data.session.id,
      sessionAccountNumber: data.session.session_account_number,
      // Carried forward to join-session, which now requires it as proof of
      // physical presence at this exact table — see join-session/index.ts's
      // security note (2026-09-10).
      qrToken,
    },
  });
  return { ok: true };
}
