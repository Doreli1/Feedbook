import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ErrorModal } from './ErrorModal';
import { useSessionParticipants } from './account/useSessionParticipants';
import { useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { useTableSessionStore } from '../lib/tableSessionStore';
import { formatCountdown, useCountdownSeconds } from '../lib/useCountdownSeconds';
import { colors } from '../theme';

// Real consent-flow feature (2026-11-17, explicit request) — mounted once at
// the root (app/_layout.tsx), not on any one screen: a personal-account link
// request, or a friend's payment closing this diner's own account for them,
// can land while this diner is anywhere in the app (ordering, reviewing a
// dish, mid-call-waiter), not only while they happen to be on
// AccountScreen/bill-summary. Both signals this reacts to
// (pendingBillingRequestFrom, leftAt) are already exposed live by
// useSessionParticipants' own realtime subscription on session_participants
// — this just derives "my own" row from it, wherever it's rendered.
export function GlobalBillingLinkListener() {
  const router = useRouter();
  const { t } = useI18n();
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);
  const suppressGlobalPaidNotice = useTableSessionStore((s) => s.suppressGlobalPaidNotice);
  const clearTableSession = useTableSessionStore((s) => s.clearTableSession);
  const { participants } = useSessionParticipants(sessionId);

  const [responding, setResponding] = useState(false);
  const [requestErrorMessage, setRequestErrorMessage] = useState<string | null>(null);

  // Real feature (2026-11-25, explicit user request): a sent "add friend"
  // request is only valid for about a minute — there's no cron in this
  // project (same constraint noted in close_zero_balance_table_sessions's
  // own comment), so expiry is swept opportunistically instead: both Edge
  // Functions in this flow (link-personal-account-members, respond-to-
  // personal-account-link) sweep on their own at the top, but neither side
  // necessarily calls either of those within any given minute — a diner
  // might just be sitting on the menu. This component is mounted exactly
  // once, globally, for the whole app session (app/_layout.tsx), so polling
  // here is the one place that reliably expires a stale request for BOTH the
  // sender and the receiver even if neither of them takes any action —
  // sweeping actually clears the DB row, so useSessionParticipants' own
  // realtime subscription (not this component) is what then refreshes the
  // UI on every device watching this session. "Up to roughly a minute," not
  // an exact deadline, is the deliberate tradeoff for this poll interval —
  // tight enough to feel immediate, loose enough not to hammer the DB.
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      void supabase.rpc('expire_stale_billing_requests');
    }, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const me = participants.find((p) => p.participantId === participantId) ?? null;
  const requester = me?.pendingBillingRequestFrom ? (participants.find((p) => p.participantId === me.pendingBillingRequestFrom) ?? null) : null;
  const requesterInitial = (requester?.displayName ?? '?').trim().charAt(0).toUpperCase() || '?';
  // Countdown badge, approver's side (2026-11-25, explicit user request,
  // top-left of this modal's own card) — same 1-minute window
  // expire_stale_billing_requests enforces server-side, just displayed here.
  const approverCountdown = useCountdownSeconds(me?.pendingBillingRequestAt ?? null, 60);

  // "1. המשתמש שצורף לחשבון - יקבל הודעה על גבי רקע מושחר עם פעולות אישור /
  // סירוב" — no neutral dismiss: onRequestClose (Android back) is a no-op,
  // the diner must actually tap one of the two real actions below.
  async function handleRespond(action: 'approve' | 'decline') {
    if (!sessionId || responding) return;
    setResponding(true);
    const { error } = await supabase.functions.invoke('respond-to-personal-account-link', {
      body: { session_id: sessionId, action },
    });
    setResponding(false);
    if (error) {
      setRequestErrorMessage(t('personalAccountLinkRequestFailedMessage'));
    }
    // On success the realtime row update clears pendingBillingRequestFrom
    // (approve) or leaves it cleared (decline) — no local state to flip
    // here, the modal closes itself once `requester` goes back to null.
  }

  // "3. ... הסשן שלו יסגר סיום התשלום, ויחזור למסך הפרופיל האישי עם הודעת
  // מערכת מותאמת כמו שקיים" — exactly mirrors bill-summary.tsx's own
  // handleCloseDone for a diner who paid for themself.
  function handlePaidByFriendDone() {
    clearTableSession();
    router.replace('/profile');
  }

  const myFirstName = me?.displayName.trim().split(/\s+/)[0] || null;
  // suppressGlobalPaidNotice (2026-11-17) is the payer's own device telling
  // this exact listener "that's me, I already have my own local success
  // modal up" — see tableSessionStore's own comment on the flag.
  const showPaidByFriend = me?.leftAt != null && !suppressGlobalPaidNotice;

  return (
    <>
      <Modal visible={requester !== null} transparent animationType="fade" onRequestClose={() => {}}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5" style={{ position: 'relative' }}>
            {/* Countdown badge (2026-11-25, explicit user request) — fixed
                physical top-left corner of the card, not reading-direction-
                relative (same "physical, not logical" choice already made
                for OrderTracker's own price text — a countdown's corner
                isn't tied to language). */}
            {approverCountdown !== null && (
              <View
                className="items-center rounded-full"
                style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 4, backgroundColor: colors.royalBlue, paddingHorizontal: 10, paddingVertical: 4 }}
              >
                <Ionicons name="timer-outline" size={13} color="#FFFFFF" />
                <Text className="text-xs font-bold text-white">{formatCountdown(approverCountdown)}</Text>
              </View>
            )}
            {requester?.photoUrl ? (
              <Image source={{ uri: requester.photoUrl }} style={{ height: 56, width: 56, borderRadius: 28, marginBottom: 12 }} />
            ) : (
              <View className="mb-3 items-center justify-center rounded-full" style={{ height: 56, width: 56, backgroundColor: colors.royalBlue }}>
                <Text className="text-lg font-bold text-white">{requesterInitial}</Text>
              </View>
            )}
            <Text className="mb-2 text-center text-lg font-bold text-[#1B2430]">{t('personalAccountLinkRequestTitle')}</Text>
            <Text className="mb-5 text-center text-sm leading-5 text-[#6E6A61]">
              {t('personalAccountLinkRequestMessage').replace('{name}', requester?.displayName ?? '')}
            </Text>
            <View className="w-full flex-row" style={{ gap: 10 }}>
              <Pressable
                onPress={() => void handleRespond('decline')}
                disabled={responding}
                className="flex-1 items-center rounded-lg border py-3"
                style={{ borderColor: colors.danger, opacity: responding ? 0.6 : 1 }}
              >
                <Text className="font-semibold" style={{ color: colors.danger }}>
                  {t('personalAccountLinkDeclineButton')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handleRespond('approve')}
                disabled={responding}
                className="flex-1 items-center rounded-lg py-3"
                style={{ backgroundColor: colors.royalBlue, opacity: responding ? 0.6 : 1 }}
              >
                <Text className="font-semibold text-white">{t('personalAccountLinkApproveButton')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ErrorModal
        visible={requestErrorMessage !== null}
        title={t('personalAccountLinkRequestFailedTitle')}
        message={requestErrorMessage ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setRequestErrorMessage(null)}
      />

      <Modal visible={showPaidByFriend} transparent animationType="fade" onRequestClose={handlePaidByFriendDone}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5">
            <View className="mb-3 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: colors.successSoft }}>
              <Ionicons name="checkmark" size={26} color={colors.success} />
            </View>
            <Text className="mb-2 text-center text-lg font-bold text-[#1B2430]">
              {myFirstName ? `${t('endVisitDoneGreetingPrefix')}${myFirstName}!` : t('endVisitDoneGreetingFallback')}
            </Text>
            <Text className="mb-5 text-center text-sm leading-5 text-[#6E6A61]">{t('paidByFriendDoneMessage')}</Text>
            <Pressable onPress={handlePaidByFriendDone} className="w-full items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('gotIt')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
