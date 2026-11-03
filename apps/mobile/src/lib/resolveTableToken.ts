import type { useRouter } from 'expo-router';
import { supabase } from './supabase';
import { extractFunctionError } from './functionError';
import { rulesFromHours, getTodayHourLines } from './formatHours';
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
export interface ScanFailure {
  ok: false;
  messageKey: TranslationKey;
  // 2026-11-02: RESTAURANT_NOT_ACTIVE/BAR_NOT_ACTIVE are a normal "closed
  // right now" state, not a real failure — scan-qr.tsx/table/[token].tsx
  // use this to show a friendlier, non-red modal instead of the generic
  // error one. Everything else (invalid code, archived table, awaiting
  // cleaning) stays 'error'.
  tone: 'error' | 'info';
  // Today's open-close ranges (e.g. "09:00-22:00"), already day-agnostic —
  // no translation needed to display these, just a lead sentence around
  // them. Only set when tone is 'info' and the relevant hours were
  // actually configured; an empty array means "closed all day today", not
  // "no data".
  hoursLines?: string[];
}

export async function resolveTableToken(
  qrToken: string,
  router: Router,
  options?: { navigate?: 'push' | 'replace' },
): Promise<{ ok: true } | ScanFailure> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { ok: false, messageKey: 'qrSessionExpired', tone: 'error' };
  }

  const { data, error } = await supabase.functions.invoke<ScanQrResponse>('scan-qr', {
    body: { qr_token: qrToken },
  });

  if (error || !data) {
    const { code, details } = await extractFunctionError(error);

    if (code === 'RESTAURANT_NOT_ACTIVE') {
      const isCertified = details?.kosher_status === 'certified';
      return {
        ok: false,
        messageKey: 'restaurantNotActive',
        tone: 'info',
        hoursLines: getTodayHourLines(rulesFromHours(details?.hours), isCertified),
      };
    }
    if (code === 'BAR_NOT_ACTIVE') {
      // Same fallback order as bar_is_active() itself: the bar's own
      // hours if it has any configured, else the restaurant's general
      // hours — showing an empty "closed all day" line from the wrong
      // schedule would be misleading.
      const barRules = rulesFromHours(details?.bar_hours);
      const rules = barRules.length > 0 ? barRules : rulesFromHours(details?.hours);
      return { ok: false, messageKey: 'barClosedScanMessage', tone: 'info', hoursLines: getTodayHourLines(rules, false) };
    }

    // 2026-11-03, user report: an archived table's rejection looked like a
    // system failure (red "הסריקה לא הצליחה" + "ניסיון נוסף" that would
    // just immediately re-scan and fail again) — same fix as the
    // restaurant/bar closed notices: a real, expected state, not an error,
    // so it gets the friendly 'info' tone (and, via that tone, the
    // scan-qr.tsx/table/[token].tsx dismiss handlers already leave the
    // scanner instead of retrying — rescanning an archived table's QR can
    // never succeed, unlike TABLE_NOT_ACTIVE's awaiting-cleaning state,
    // which genuinely can clear up if staff act soon, so that one keeps
    // the ordinary error/retry tone).
    if (code === 'TABLE_ARCHIVED') {
      return { ok: false, messageKey: 'tableArchived', tone: 'info' };
    }

    return {
      ok: false,
      tone: 'error',
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

// Shared by scan-qr.tsx/table/[token].tsx so the "closed right now" body
// text (lead sentence + today's hours, or an explicit "closed today" line)
// is composed identically in both places instead of copied twice.
export function buildScanFailureMessage(outcome: ScanFailure, t: (key: TranslationKey) => string): string {
  const base = t(outcome.messageKey);
  if (outcome.tone !== 'info' || !outcome.hoursLines) return base;
  const hoursPart = outcome.hoursLines.length > 0 ? `${t('todayHoursPrefix')} ${outcome.hoursLines.join(', ')}` : t('closedTodayMessage');
  return `${base} ${hoursPart}`;
}
