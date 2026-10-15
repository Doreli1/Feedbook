import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface OpenSessionReminder {
  sessionId: string;
  participantId: string;
  restaurantId: string;
  restaurantName: string;
  tableId: string;
  tableNumber: string;
  tableType: string | null;
  sessionAccountNumber: string;
  subAccountNumber: string;
  barTicketNumber: number | null;
  reviewVerificationCode: string;
  qrToken: string;
}

// Mail-icon "open visit" reminder (2026-10-16, user request): a diner who
// loses track of an open, unpaid table session (e.g. the local
// tableSessionStore was cleared, or they simply closed the app) has no way
// to find their way back to it otherwise — see Implementation Plan §14.
// get_my_open_session() is a security definer RPC (same cross-RLS-boundary
// pattern as current_staff_restaurant_ids()) since a diner's client has no
// read grant on `tables` at all; this returns only the minimal display
// fields, never raw row access. Fetched once per mount (profile.tsx,
// OrderingHeader.tsx) rather than subscribed live — this is a gentle
// reminder, not a real-time feed.
//
// Returns every field tableSessionStore.setTableSession() needs (expanded
// 2026-10-16, real gap found: the original "scan QR to return" CTA was a
// dead end for a diner who already left the restaurant) — resuming an
// already-joined session needs no fresh qr_token the way joining one for
// the first time does (join-session's own physical-presence check is about
// proving presence to JOIN, not about re-proving it to resume a
// relationship that already exists), and the RPC only ever returns a
// session that's still genuinely 'open' server-side, so this can't resume
// something stale.
export function useOpenSessionReminder(userId: string | undefined) {
  const [reminder, setReminder] = useState<OpenSessionReminder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setReminder(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      const { data } = await supabase.rpc('get_my_open_session').maybeSingle();
      if (cancelled) return;
      setReminder(
        data
          ? {
              sessionId: data.session_id,
              participantId: data.participant_id,
              restaurantId: data.restaurant_id,
              restaurantName: data.restaurant_name,
              tableId: data.table_id,
              tableNumber: data.table_number,
              tableType: data.table_type,
              sessionAccountNumber: data.session_account_number,
              subAccountNumber: data.sub_account_number,
              barTicketNumber: data.bar_ticket_number,
              reviewVerificationCode: data.review_verification_code,
              qrToken: data.qr_token,
            }
          : null,
      );
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { reminder, loading };
}
