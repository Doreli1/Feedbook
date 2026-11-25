import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface SessionParticipant {
  participantId: string;
  displayName: string;
  photoUrl: string | null;
  isHost: boolean;
  // Set once this participant has been added to ANOTHER participant's own
  // personal account (2026-11-15, real feature — see
  // 20261115090000_personal_account_members.sql) — null means they pay for
  // themself, the default/common case. Points at the participantId whose
  // account their charges are actually billed to.
  billedToParticipantId: string | null;
  // Set once this participant has paid and left (2026-11-17, real bug found
  // live: a diner who'd already paid kept showing up as an addable
  // table-mate in the "add friend to my personal account" picker, since
  // nothing here ever exposed left_at at all). null = still an active
  // diner at the table.
  leftAt: string | null;
  // Set to the requester's own participantId while a personal-account link
  // request is awaiting THIS participant's own approval (2026-11-17, real
  // consent flow — adding someone used to take effect unilaterally). null
  // once approved (billedToParticipantId takes over) or declined.
  pendingBillingRequestFrom: string | null;
}

// Table-mates row (ניהול חשבון, מוקאפים 10.1/10.2) — every participant who
// ever joined this session, whichever path they joined through (direct QR
// scan or add-participants' own self-join) already lands in
// session_participants the same way, so there is nothing path-specific to
// filter here.
//
// Goes through session_participant_profiles() (2026-10-10) rather than a
// plain join to user_profiles — that table's RLS is "own profile only"
// (owner_manage_own_profile), so a plain client-side join would silently
// come back empty for every table-mate but the caller themselves. The
// function is the narrow, session-scoped exception to that, verified
// directly against the local DB as a real participant (not just re-read as
// SQL): an unrelated caller gets zero rows for someone else's session.
export function useSessionParticipants(sessionId: string | null) {
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setParticipants([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase.rpc('session_participant_profiles', { p_session_id: sessionId });
    setParticipants(
      (data ?? []).map((row) => ({
        participantId: row.participant_id,
        displayName: row.display_name,
        photoUrl: row.profile_photo_url,
        isHost: row.is_host,
        billedToParticipantId: row.billed_to_participant_id,
        leftAt: row.left_at,
        pendingBillingRequestFrom: row.pending_billing_request_from,
      })),
    );
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    // Initial fetch on mount/sessionId change — refresh() sets state only
    // after its own await resolves, not synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Live-updates the row the moment someone else joins the same table, OR
  // (2026-11-15) the moment anyone's billedToParticipantId changes — adding
  // a member to a personal account is a plain UPDATE on an existing row,
  // not an INSERT, so this widened from 'INSERT' to '*' to actually pick
  // that up live too. Matches the "שוטף" expectation already set for the
  // account screen's other data (AFD §3.10). Unfiltered subscribe +
  // refetch, same pattern as apps/web/src/screens/Dashboard.tsx's own
  // kitchen channel: RLS on the underlying RPC still correctly narrows what
  // refresh() can actually see.
  useEffect(() => {
    if (!sessionId) return;
    // Unique per-mount suffix — AccountScreen fully unmounts/remounts on every
    // tab switch (conditional `&&` render in OrderingScreen.tsx), and
    // removeChannel()'s unsubscribe is async. A name scoped only by sessionId
    // risks a remount's effect firing before the previous instance's teardown
    // resolves, in which case supabase.channel() hands back the same,
    // already-subscribed channel object and .on() throws "cannot add
    // postgres_changes callbacks ... after subscribe()". A fresh name per
    // effect run sidesteps the race entirely — nothing outside this hook
    // depends on the channel name.
    const channel = supabase
      .channel(`session-participants-${sessionId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_participants', filter: `session_id=eq.${sessionId}` }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, refresh]);

  return { loading, participants, refresh };
}
