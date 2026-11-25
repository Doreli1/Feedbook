import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, HeaderBackButton, HeaderMenu } from '../src/components/AppHeader';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { ErrorModal } from '../src/components/ErrorModal';
import { CallWaiterModals, useCallWaiter } from '../src/components/CallWaiterButton';
import { ParticipantsRow, StripCell } from '../src/components/account/AccountScreen';
import { useAccountItems } from '../src/components/account/useAccountItems';
import { useSessionParticipants } from '../src/components/account/useSessionParticipants';
import { extractFunctionErrorCode } from '../src/lib/functionError';
import { goBackOrHome } from '../src/lib/goBackOrHome';
import { useI18n, visualRowDirection, physicalReadingStart } from '../src/lib/i18n';
import { formatPrice } from '../src/lib/formatPrice';
import { supabase } from '../src/lib/supabase';
import { useTableSessionStore } from '../src/lib/tableSessionStore';
import { formatCountdown, useCountdownSeconds } from '../src/lib/useCountdownSeconds';
import { colors } from '../src/theme';

// Bill summary — real mockup supplied 2026-11-08, revised the same day after
// a first round of feedback (card/avatar styling parity with AccountScreen,
// rectangular split button, a real tip card instead of a flat service-fee
// line, card-brand wording, symmetric payment-preference rows, and a real
// waiter-call trigger on "מזומן"). Temporary, explicit stand-in for Stage
// 6's real payment flow (per the diner-app owner's own framing: "להגדיר
// זמנית... כדימוי לסגירת חשבון הכוללת ביצוע תשלום"), so the rest of the
// manual QA checklist can exercise a close-the-bill path without waiting on
// real payment integration. Pushed from AccountScreen.tsx's "סגרו חשבון"
// button (in place of the earlier plain "coming soon" modal) whenever this
// diner has a real personal balance to pay.
//
// Two pieces are honest placeholders, not hidden gaps (same "show the
// real state, don't fake what isn't built" approach as add-participants.tsx):
// the SMS-receipt checkbox is local UI state only — no real SMS sending; and
// the card-on-file label below (billSummaryCardLabel) is a fixed placeholder
// string, not read from any real stored-payment-method record — nothing
// like that exists anywhere in this schema yet (checked repo-wide), so
// there is nothing real to source it from until Stage 6 defines one. The
// bottom "בצעו תשלום" button is the one real trigger either way (2026-11-08,
// explicit correction — selecting "מזומן" used to fire the waiter call by
// itself; the radio is now a plain selection, nothing more): with "כרטיס
// אשראי" selected it calls confirm-card-payment (2026-11-09 — used to call
// plain close-session, a real gap: that never wrote any real payment
// record, so the account's own status on the Web Admin side never actually
// became "שולם" — see confirm-card-payment/index.ts's own comment for the
// full diagnosis); with "מזומן" selected it instead fires a real
// call-waiter request carrying this account's own details as its reason —
// see handlePayButtonPress below.
//
// Tip replaces a flat "service fee" line from the first draft of this
// screen (2026-11-08 same-day correction) — this app pools tips rather than
// charging a mandatory service fee (project_payments_and_cancellation_rules
// memory), and a flat fee line also directly contradicted AccountScreen's
// own standing disclaimer one screen back ("דמי השירות אינם כלולים בחשבון").
// A real tip, diner-controlled, doesn't have that problem. Redesigned
// 2026-11-10 (explicit user decision) from a restaurant-configured on/off
// policy (minimum_tip_percent/tip_policy_enabled, both removed from
// restaurants) to a fixed, app-wide 0/5/10/15/20/25% choice every diner
// makes for themselves, with no pre-selected default — see tipMode's own
// comment below for why 0% has to be an explicit tap, not an implicit
// starting state.
export default function BillSummaryScreen() {
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const insets = useSafeAreaInsets();

  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);
  const sessionAccountNumber = useTableSessionStore((s) => s.sessionAccountNumber);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  const isBarTable = useTableSessionStore((s) => s.tableType === 'bar');
  const barTicketNumber = useTableSessionStore((s) => s.barTicketNumber);
  const clearTableSession = useTableSessionStore((s) => s.clearTableSession);
  const setSuppressGlobalPaidNotice = useTableSessionStore((s) => s.setSuppressGlobalPaidNotice);
  // Same fallback as AccountScreen.tsx's own personalAccountDisplay — a bar
  // diner's "personal account" is their pickup-ticket number, not
  // subAccountNumber (see tableSessionStore.ts's own comment).
  const personalAccountDisplay = isBarTable ? (barTicketNumber != null ? String(barTicketNumber).padStart(4, '0') : '—') : (subAccountNumber ?? '—');

  const { items } = useAccountItems(sessionId);
  const { participants, refresh: refreshParticipants } = useSessionParticipants(sessionId);

  // Real feature (2026-11-15, explicit request): who's currently billed to
  // THIS diner's own account (see session_participants.billed_to_participant_id,
  // 20261115090000_personal_account_members.sql) vs. who's still eligible to
  // be added (not self, and not already part of someone ELSE's account —
  // the link-personal-account-members Edge Function enforces the same rule
  // server-side, this is just what the picker below offers). Gates
  // billSummarySplitEquallyButton's own visibility below — a real
  // precondition now instead of the (incorrect, per user correction)
  // "anyone else at the whole table" check this used to have.
  // leftAt !== null excludes a diner who already paid and left (2026-11-17,
  // real bug found live: someone who'd already settled their own bill kept
  // showing up as an addable/already-added table-mate here, since nothing
  // checked this before — session_participant_profiles() didn't even
  // expose left_at until now). A departed diner has nothing left to
  // combine; both lists below are scoped to who's still actually there.
  const myAccountMembers = participants.filter((p) => p.billedToParticipantId === participantId && p.leftAt === null);
  // Real consent flow (2026-11-17, explicit request): adding a friend no
  // longer takes effect unilaterally — it sends a request (pendingBillingRequestFrom)
  // that the friend must approve themselves (the global listener in
  // app/_layout.tsx shows them that prompt) before they become a real
  // member above. Tracked separately so the picker can show "ממתין לאישור"
  // for someone already asked, distinct from someone not yet asked at all.
  const myPendingRequests = participants.filter((p) => p.pendingBillingRequestFrom === participantId && p.leftAt === null);
  // Real bug found live (2026-11-25): nothing here ever blocked payment
  // while a sent request was still unanswered — picking a tip and paying
  // went straight through on just the caller's own share, leaving the
  // friend with a dangling approve/decline prompt (GlobalBillingLinkListener)
  // for a request that's now moot. See hasPendingRequest's own use below
  // (disables the pay button) and handleCancelPendingRequests (the explicit
  // way out, short of waiting for the friend to actually respond).
  const hasPendingRequest = myPendingRequests.length > 0;
  // Countdown badge, sender's side (2026-11-25, explicit user request,
  // bottom-left of the notice box below) — same pendingBillingRequestAt the
  // target's own row carries (set once, read from both sides), same
  // 1-minute window expire_stale_billing_requests enforces server-side.
  const pendingRequestCountdown = useCountdownSeconds(myPendingRequests[0]?.pendingBillingRequestAt ?? null, 60);
  // The combined group this diner is actually paying for once at least one
  // friend has been added — just themself when myAccountMembers is empty
  // (the common/default case), so combinedSubtotal below collapses back to
  // plain subtotal and nothing downstream changes for a solo diner. Only
  // approved members count here — a still-pending request isn't part of the
  // bill yet, matching confirm-card-payment's own billed_to_participant_id-
  // only group fetch.
  const combinedGroupParticipantIds = [participantId, ...myAccountMembers.map((m) => m.participantId)];
  const eligibleFriends = participants.filter(
    (p) =>
      p.participantId !== participantId &&
      p.leftAt === null &&
      ((p.billedToParticipantId === null && p.pendingBillingRequestFrom === null) ||
        p.billedToParticipantId === participantId ||
        p.pendingBillingRequestFrom === participantId),
  );
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [linkingFriends, setLinkingFriends] = useState(false);
  const [linkFriendsErrorMessage, setLinkFriendsErrorMessage] = useState<string | null>(null);
  // "!" info button next to the heading above the carousel (2026-11-15,
  // explicit request) — same pattern as AccountScreen.tsx's own infoOpen.
  const [addFriendInfoOpen, setAddFriendInfoOpen] = useState(false);

  function openFriendPicker() {
    setSelectedFriendIds(new Set([...myAccountMembers, ...myPendingRequests].map((p) => p.participantId)));
    setFriendPickerOpen(true);
  }

  function toggleFriendSelected(id: string) {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Sends the FULL desired set (members + still-pending requests), not just
  // additions (2026-11-15, real gap found live — reopening this picker after
  // adding someone had no way to undo it, since every checkbox for an
  // already-added member was disabled). The Edge Function reconciles both
  // directions itself: anyone newly checked gets a real request sent to
  // them (2026-11-17, real consent flow — no longer an instant link, see
  // link-personal-account-members's own comment), anyone unchecked that was
  // previously a member/pending request gets cleared back to paying for
  // themself. A no-op (nothing actually changed) just closes the modal
  // without a network call. Shared by the picker's own "אישור" and the
  // carousel's direct X-badge removal below.
  async function submitAccountMembership(memberIds: string[]) {
    if (!sessionId) return;
    setLinkingFriends(true);
    const { error } = await supabase.functions.invoke('link-personal-account-members', {
      body: { session_id: sessionId, member_participant_ids: memberIds },
    });
    setLinkingFriends(false);
    if (error) {
      setLinkFriendsErrorMessage(t('addAccountMembersFailedMessage'));
      return;
    }
    void refreshParticipants();
  }

  async function handleConfirmFriendPicker() {
    if (!sessionId) {
      setFriendPickerOpen(false);
      return;
    }
    const currentMemberIds = new Set([...myAccountMembers, ...myPendingRequests].map((m) => m.participantId));
    const unchanged = selectedFriendIds.size === currentMemberIds.size && Array.from(selectedFriendIds).every((id) => currentMemberIds.has(id));
    if (unchanged) {
      setFriendPickerOpen(false);
      return;
    }
    await submitAccountMembership(Array.from(selectedFriendIds));
    setFriendPickerOpen(false);
  }

  // X-badge removal straight from the carousel (2026-11-15, explicit
  // request, same badge styling as add-participants.tsx's own deselect
  // badge) — an alternative to reopening the "+" picker and unchecking,
  // not a replacement for it. Posts the remaining membership (everyone
  // currently billed to me, minus this one).
  function handleRemoveAccountMember(removeParticipantId: string) {
    void submitAccountMembership(myAccountMembers.filter((m) => m.participantId !== removeParticipantId).map((m) => m.participantId));
  }

  // The explicit "cancel" action next to the pending-request payment-block
  // notice below (2026-11-25, user request) — posts only the already-
  // APPROVED members as the desired set, so link-personal-account-members
  // clears every still-pending request (not in that list) while leaving any
  // already-approved member untouched. Clearing pending_billing_request_from
  // server-side is also what makes the friend's own approve/decline modal
  // (GlobalBillingLinkListener, driven by that same column via realtime)
  // disappear on their device — no separate "withdraw the notification"
  // step needed, it's the same signal both sides already watch.
  function handleCancelPendingRequests() {
    void submitAccountMembership(myAccountMembers.map((m) => m.participantId));
  }

  // Real request (2026-11-25): the background sweep (GlobalBillingLinkListener's
  // own 5s poll + both Edge Functions' own opportunistic call) is the
  // server-side source of truth for expiry, but proved unreliable to observe
  // actually firing during testing — this is a deterministic client-side
  // backup, tied directly to the same countdown the diner is watching: the
  // instant it visibly reaches 0 on the SENDER's own screen, cancel for
  // real, same action as tapping "ביטול הבקשה" by hand. Only fires once per
  // expiry (pendingRequestCountdown going from >0 to exactly 0 is a single
  // state transition — React doesn't re-render for a value that didn't
  // change, so this doesn't re-fire every second while it sits at 0), and
  // only while there's still something to cancel.
  useEffect(() => {
    if (pendingRequestCountdown === 0 && hasPendingRequest) {
      handleCancelPendingRequests();
    }
  }, [pendingRequestCountdown, hasPendingRequest]);

  const me = participants.find((p) => p.participantId === participantId);
  const myFirstName = me?.displayName.trim().split(/\s+/)[0] || null;
  // Oldest-first (useSessionParticipants's own convention, see
  // ParticipantsRow's comment) — this diner's own position in that order is
  // the closest honest meaning of "סועד 1/2/3..." the real mockup shows,
  // short of a real seat-numbering feature that doesn't exist.
  const myIndex = participants.findIndex((p) => p.participantId === participantId);
  const dinerNumber = myIndex >= 0 ? myIndex + 1 : 1;

  const subtotal = items.filter((i) => i.participantId === participantId).reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  // Real split/full-payment choice (2026-11-15, explicit request) — once at
  // least one friend is on this diner's own personal account, the automatic
  // default is an even split of the COMBINED order across the whole group
  // (this diner + every added friend), with full payment for the group as
  // the alternative. combinedSubtotal reads every member's own order_items
  // from the same `items` list AccountScreen's items hook already pulls for
  // the whole session — no separate fetch needed. The server (confirm-card-
  // payment) recomputes all of this itself from order_items and never
  // trusts these client-side numbers; they're preview-only.
  const [splitMode, setSplitMode] = useState<'even' | 'full'>('even');
  const combinedSubtotal =
    myAccountMembers.length > 0
      ? items.filter((i) => combinedGroupParticipantIds.includes(i.participantId)).reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
      : subtotal;
  const myShareOfCombined = myAccountMembers.length > 0 ? combinedSubtotal / combinedGroupParticipantIds.length : subtotal;
  const amountIOwe = myAccountMembers.length === 0 ? subtotal : splitMode === 'even' ? myShareOfCombined : combinedSubtotal;

  // Tip redesign (2026-11-10, explicit user decision — replaces the
  // 2026-11-09 restaurant-configured policy entirely): no more per-
  // restaurant enable toggle or minimum-percent floor — every diner picks
  // their own percentage from a fixed, app-wide 0/5/10/15/20/25% range (or
  // a free amount), every time, with no restaurant-side control over it at
  // all. tipMode starts at 'percent' — that's the view shown on load (the
  // chips row, not the free-amount field) — but tipPercent starts at null:
  // no specific percentage is pre-selected, so the diner still has to tap
  // one explicitly (even "0%" counts as one) before the pay button below
  // unlocks, see hasChosenTip. Two different things: which VIEW shows by
  // default vs. whether a VALUE is already chosen for them.
  const [tipMode, setTipMode] = useState<'percent' | 'custom'>('percent');
  const [tipPercent, setTipPercent] = useState<number | null>(null);
  const [tipCustomAmount, setTipCustomAmount] = useState('');
  const customTipAmount = Number(tipCustomAmount.replace(',', '.')) || 0;
  // Real bug found live (2026-11-25): every tip calculation below used to
  // read `subtotal` (this diner's OWN order only) unconditionally, even once
  // a friend was added — a 5% tip on a 60₪/70₪ combined 130₪ account came
  // out to 3₪ (5% of 60) instead of the diner's own intended 6.5₪ (5% of
  // 130), and the restaurant's own tip records only ever reflected one
  // diner's personal slice, never the pair's real combined total. Fixed by
  // making the BASE itself an explicit choice (user request) rather than
  // silently always picking one or the other — tipBase only matters once a
  // friend is actually on this account; see tipBaseAmount below, which
  // collapses back to plain `subtotal` either way for a solo diner.
  const [tipBase, setTipBase] = useState<'personal' | 'combined'>('personal');
  const tipBaseAmount = myAccountMembers.length > 0 && tipBase === 'combined' ? combinedSubtotal : subtotal;
  // Free-amount floor (2026-11-10, explicit request): a diner who wants to
  // name their own amount still has to mean it as a real tip, not a token
  // few agorot — 5% of the chosen tip base, the same floor the percent chips
  // themselves start from. Doesn't apply to the chips (0% is a real,
  // offered choice on its own).
  const customTipMeetsMinimum = customTipAmount >= tipBaseAmount * 0.05;
  const hasChosenTip =
    tipMode === 'percent' ? tipPercent !== null : tipMode === 'custom' ? tipCustomAmount.trim() !== '' && customTipMeetsMinimum : false;
  const tipAmount = tipMode === 'percent' && tipPercent !== null ? tipBaseAmount * (tipPercent / 100) : tipMode === 'custom' && customTipMeetsMinimum ? customTipAmount : 0;
  const total = amountIOwe + tipAmount;

  // "X סועדים נתנו טיפ היום" (2026-11-10, explicit request) — real social-
  // proof count, same "real data only, hide entirely at zero" rule AND the
  // same live-refresh shape as MenuBrowser.tsx's own dish order-activity
  // line (useDishOrderStats): subscribe unfiltered to the table whose
  // change actually drives this number (payment_participant_shares has no
  // restaurant_id column of its own to filter by at the subscription level
  // — same reasoning as that hook's own order_items channel), then refetch
  // the restaurant-scoped RPC on every change, letting the function's own
  // query (not the subscription) narrow it down. Corrected 2026-11-10 from
  // an earlier one-time-fetch version — a diner sitting on this screen
  // while someone else tips should see the count update live, same as
  // every other "today" counter in this app already does.
  const [tippersToday, setTippersToday] = useState<number | null>(null);
  useEffect(() => {
    if (!restaurantId) return;
    const rid = restaurantId;
    let cancelled = false;

    async function refreshTippersToday() {
      const { data } = await supabase.rpc('get_tippers_today_count', { p_restaurant_id: rid });
      if (!cancelled) setTippersToday((data as number | null) ?? null);
    }

    void refreshTippersToday();
    const channel = supabase
      .channel(`bill-summary-tippers-today-${rid}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_participant_shares' }, () => void refreshTippersToday())
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('card');
  const [smsReceipt, setSmsReceipt] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeFailedMessage, setCloseFailedMessage] = useState<string | null>(null);
  const [closeDoneOpen, setCloseDoneOpen] = useState(false);

  const { calling: cashCalling, called: cashCalled, error: cashError, handlePress: triggerCashWaiterCall, dismissCalled: dismissCashCalled, dismissError: dismissCashError } = useCallWaiter();

  // The radio button itself is just a plain selection, nothing more
  // (2026-11-08, explicit correction — it used to fire the waiter call
  // immediately on selection). The real trigger is the bottom "בצעו תשלום"
  // button, see handlePayButtonPress below.

  // Real gap found live (2026-11-09): this used to call ONLY close-session
  // (just flips table_sessions.status) — it never wrote any real payment
  // record, so the diner's own personal share never actually became
  // 'paid', and the Web Admin's Accounts module correctly never showed the
  // account as "שולם" (useAccounts.ts's bottom-up computation requires a
  // real settled participant, not just a closed session — see
  // confirm-card-payment/index.ts's own comment for the full diagnosis).
  // Now calls confirm-card-payment, which settles THIS diner's own share
  // for real (server-computed subtotal + the tip chosen above) and
  // deliberately does NOT touch table_sessions.status — same reasoning as
  // the cash path's confirm-cash-payment: the account becomes "שולם" once
  // every real participant is paid, closing the physical table is a
  // separate, already-existing concern.
  async function handleCloseAccount() {
    if (!sessionId || closing) return;
    setClosing(true);
    // Real feature (2026-11-17): this diner's own left_at is about to be
    // set by this very call — the global "someone else paid for you"
    // listener (app/_layout.tsx) watches that exact signal, and without
    // this flag it would show its own modal on top of this screen's own
    // local one for the diner who's actually the one paying right now.
    // tableSessionStore resets this back to false on the next
    // setTableSession/clearTableSession, so it can never leak into a later
    // visit.
    setSuppressGlobalPaidNotice(true);
    const { error } = await supabase.functions.invoke('confirm-card-payment', {
      body: { session_id: sessionId, tip_amount: tipAmount, split_mode: splitMode },
    });
    setClosing(false);
    if (error) {
      // Real duplicate-payment bug found live (2026-11-09): a second
      // "בצעו תשלום" tap after an already-successful payment (e.g. the
      // diner never dismissed the first success modal, or the app reloaded
      // before they did) used to write a whole second payment record —
      // see confirm-card-payment/index.ts's own comment. The server now
      // rejects it with ALREADY_PAID instead of silently duplicating it;
      // treated here as the same soft success the diner would have gotten
      // the first time, not an error, so re-tapping pay always ends with
      // the same "you're done" flow and gets them off this now-settled
      // account either way.
      const code = await extractFunctionErrorCode(error);
      if (code === 'ALREADY_PAID') {
        // left_at really is already set for this diner (that's exactly what
        // ALREADY_PAID means) — suppressGlobalPaidNotice must stay true so
        // the global listener doesn't ALSO fire for this same, already-
        // locally-handled completion.
        setCloseDoneOpen(true);
        return;
      }
      // A genuine failure — the payment never went through, so left_at was
      // never set and there is nothing for the global listener to suppress.
      setSuppressGlobalPaidNotice(false);
      setCloseFailedMessage(t('billSummaryCloseFailedMessage'));
      return;
    }
    setCloseDoneOpen(true);
  }

  function handleCloseDone() {
    setCloseDoneOpen(false);
    clearTableSession();
    router.replace('/profile');
  }

  // "בצעו תשלום" (2026-11-08, explicit correction — this used to always
  // call close-session regardless of the chosen payment method). With
  // "מזומן" selected, this is the one real trigger for the cash-payment
  // waiter call (call-waiter's own `reason` field, carrying every account
  // detail a waiter needs to find and settle this diner: table, general
  // account, personal account, and the amount actually due including tip)
  // — close-session is NOT called here, since cash isn't actually
  // collected yet; the account only closes once staff confirms the cash
  // payment (confirm-cash-payment), which settles just this diner's own
  // share (see that function's own comment). With "כרטיס אשראי" selected,
  // this stays the original instant "payment succeeded" stand-in.
  function handlePayButtonPress() {
    if (paymentMethod === 'cash') {
      if (cashCalling) return;
      const reason = [
        t('billSummaryCashReasonSubject'),
        `${t('tableLabel')} ${tableNumber ?? '—'}`,
        `${t('accountStripGeneralLabel')} ${sessionAccountNumber ?? '—'}`,
        `${t('accountStripPersonalLabel')} ${personalAccountDisplay}`,
        `${t('accountTotalLabel')} ₪${formatPrice(total)}`,
      ].join(' · ');
      void triggerCashWaiterCall({ reason, callType: 'cash_payment' });
      return;
    }
    void handleCloseAccount();
  }

  // Fixed, app-wide range — 0% through 25% in steps of 5 (2026-11-10,
  // explicit request, replacing the restaurant-configured floor this used
  // to generate from). 0% is a real, equally-weighted option, not a
  // disabled/hidden state — choosing it is exactly how a diner who doesn't
  // want to tip satisfies hasChosenTip. All six always share one row (see
  // the flex-1 chips below) — "סכום" (free amount) is its own separate
  // control underneath, not a seventh chip in this same row anymore (two
  // "tabs": tipMode==='percent' shows this row, tipMode==='custom' hides it
  // in favor of the free-amount input — see the JSX below).
  const tipPercentOptions = [0, 5, 10, 15, 20, 25];

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <AppHeader
        right={
          <>
            <HeaderBackButton onPress={() => goBackOrHome(router)} />
            <FeedbookWordmark size={24} />
          </>
        }
        left={<HeaderMenu />}
      />

      {/* Real bug (2026-11-10, user report, on a real Android device): the
          free-amount TextInput sits well down the page and the keyboard
          covered it with no way to see what was typed. Two earlier attempts
          failed: KeyboardAvoidingView behavior="height" on Android double-
          resized the screen (on top of Expo's own default window-resize)
          and squeezed everything into a sliver; a manual scrollToEnd() on
          focus overshot past the input (it isn't the last thing in this
          scroll view — the payment-preference section and SMS row still
          follow it) and left it just as cut off. KeyboardAwareScrollView
          (already the established, proven pattern for exactly this in
          email-auth.tsx/forgot-password.tsx/etc. — pure JS, no native
          module, so it works in plain Expo Go) measures the actually-
          focused input and scrolls precisely to it instead of guessing.
          The pay button moved inside it (was a separate fixed bar below the
          scroll area) so the library's own math accounts for it the same
          way email-auth.tsx's submit button already does, rather than
          risking the two fighting over how much room the keyboard leaves. */}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={80}
        keyboardOpeningTime={0}
      >
        {/* No longer fixed above this scroll area (2026-11-10, explicit
            request — both the account-info strip and the avatar carousel
            now scroll away with the rest of the content instead of staying
            pinned). Same StripCell + card chrome as AccountScreen.tsx's own
            number strip (2026-11-08, explicit request to match its styling
            exactly, not approximate it). */}
        <View className="overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <View className="items-stretch px-1 py-2" style={{ flexDirection: rowDirection }}>
            {/* Real bug found live (2026-11-15): this label reads "חשבון
                האישי שלכם" (your PERSONAL account) but was bound to
                sessionAccountNumber — the GENERAL account shared by the
                whole table — instead of personalAccountDisplay, so it
                showed the wrong number (e.g. 635287 instead of this
                diner's own 714295, matching AccountScreen.tsx's own strip). */}
            <StripCell label={t('billSummaryAccountLabel')} value={personalAccountDisplay} />
            <View className="w-px" style={{ backgroundColor: colors.border }} />
            <StripCell label={t('billSummaryTableNumberLabel')} value={tableNumber ?? '—'} />
            <View className="w-px" style={{ backgroundColor: colors.border }} />
            <StripCell label={t('billSummaryGuestNameLabel')} value={me?.displayName ?? '—'} />
          </View>
        </View>

        {/* Moved above the carousel (2026-11-15, explicit request), styled
            as a dominant section heading — same text-lg font-bold treatment
            as billSummaryTipTitle/billSummaryPaymentPreferenceTitle below —
            instead of the small centered muted caption it used to be. "!"
            info button beside it (same spot) explains the add-member
            feature's own logic — same small light-blue circle +
            information-outline icon convention as AccountScreen.tsx's own
            info button (which explains the account-strip terms instead). */}
        <View className="mt-4 items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
          <Text className="text-lg font-bold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
            {t('billSummaryAddFriendCaption')}
          </Text>
          <Pressable
            onPress={() => setAddFriendInfoOpen(true)}
            hitSlop={10}
            className="h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: '#38BDF8' }}
          >
            <Ionicons name="information-outline" size={14} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ParticipantsRow renders its own edge-to-edge white strip with a
            border-bottom spanning the full screen width (see its own
            definition, AccountScreen.tsx) — the negative horizontal margin
            cancels out this ScrollView's own 16px side padding so it still
            reaches both edges now that it scrolls with everything else
            instead of sitting outside the padded area.
            Scoped to just this diner's own personal-account group — me plus
            whoever's actually been added (combinedGroupParticipantIds) —
            not the whole table (2026-11-15, explicit correction: this used
            to pass every session participant, the same full roster
            AccountScreen.tsx's general-account tab shows; this carousel is
            "who's in my account right now", which is just me until someone
            is actually added, not everyone sharing the table).
            removableParticipantIds/onRemoveParticipant (2026-11-15, explicit
            request) — an X badge on each added friend's own avatar, same
            styling as add-participants.tsx's own deselect badge; never
            includes participantId itself, so my own avatar never shows it. */}
        <View style={{ marginHorizontal: -16, marginTop: 8 }}>
          <ParticipantsRow
            participants={participants.filter((p) => combinedGroupParticipantIds.includes(p.participantId))}
            onAddPress={openFriendPicker}
            removableParticipantIds={new Set(myAccountMembers.map((m) => m.participantId))}
            onRemoveParticipant={handleRemoveAccountMember}
          />
        </View>

        {/* Price breakdown — no row dividers, bigger text (2026-11-08,
            explicit request). */}
        <View className="mt-4 overflow-hidden rounded-xl bg-white px-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <View className="items-center justify-between py-3.5" style={{ flexDirection: rowDirection }}>
            <Text className="text-base" style={{ color: colors.ink }}>
              {/* "סועד {n}" only while solo — once a combined group exists,
                  that reads ambiguously next to "ההזמנה המשותפת (X סועדים)"
                  below it (2026-11-15, explicit request: is "1" also a
                  diner count?). "ההזמנה האישית שלך" says plainly that this
                  one line is just the viewer's own order. */}
              {myAccountMembers.length > 0 ? t('billSummaryMyOwnOrderLabel') : t('billSummaryDinerLineLabel').replace('{n}', String(dinerNumber))}
            </Text>
            <Text className="text-base font-semibold" style={{ color: colors.ink }}>
              ₪{formatPrice(subtotal)}
            </Text>
          </View>
          {/* Combined-group lines (2026-11-15, real feature) — only once a
              friend has actually been added. "Your share" only applies in
              even-split mode; in full-payment mode amountIOwe already equals
              combinedSubtotal, so showing both would just repeat the same
              number twice. */}
          {myAccountMembers.length > 0 && (
            <View className="items-center justify-between py-3.5" style={{ flexDirection: rowDirection }}>
              <Text className="text-base" style={{ color: colors.ink }}>
                {t('billSummaryGroupOrderLabel').replace('{n}', String(combinedGroupParticipantIds.length))}
              </Text>
              <Text className="text-base font-semibold" style={{ color: colors.ink }}>
                ₪{formatPrice(combinedSubtotal)}
              </Text>
            </View>
          )}
          {myAccountMembers.length > 0 && splitMode === 'even' && (
            <View className="items-center justify-between py-3.5" style={{ flexDirection: rowDirection }}>
              <Text className="text-base" style={{ color: colors.ink }}>
                {t('billSummaryYourShareLabel')}
              </Text>
              <Text className="text-base font-semibold" style={{ color: colors.ink }}>
                ₪{formatPrice(myShareOfCombined)}
              </Text>
            </View>
          )}
          {tipAmount > 0 && (
            <View className="items-center justify-between py-3.5" style={{ flexDirection: rowDirection }}>
              <Text className="text-base" style={{ color: colors.ink }}>
                {t('billSummaryTipTitle')}
              </Text>
              <Text className="text-base font-semibold" style={{ color: colors.ink }}>
                ₪{formatPrice(tipAmount)}
              </Text>
            </View>
          )}
          <View className="items-center justify-between py-3.5" style={{ flexDirection: rowDirection }}>
            <Text className="text-lg font-bold" style={{ color: colors.ink }}>
              {t('billSummaryTotalLabel')}
            </Text>
            <Text className="text-lg font-bold" style={{ color: colors.success }}>
              ₪{formatPrice(total)}
            </Text>
          </View>
          {/* 2026-11-08, explicit request — directly under the total line. */}
          <Text className="pb-3 text-xs" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
            {t('billSummaryVatNote')}
          </Text>
        </View>

        {/* Real split/full-payment choice (2026-11-15, explicit request,
            replaces the earlier "coming soon" placeholder). Hidden entirely,
            not just dimmed, while no one has been added to THIS diner's own
            personal account yet (2026-11-15, user correction — the original
            version checked "anyone else at the whole table," which is
            wrong: a shared table can seat several unrelated parties, each
            with their own untouched personal account, see
            session_participants.billed_to_participant_id's own comment).
            Equal split is the default/pre-selected value (explicit
            request). Sitting directly on the screen's own background now,
            no card/title wrapper (2026-11-15, explicit correction — the
            "אופן התשלום" card itself is gone, just the two buttons), same
            visual language as the tip card's own percent chips: selected =
            filled royalBlue, unselected = white with a border. */}
        {myAccountMembers.length > 0 && (
          <View className="mt-4" style={{ flexDirection: rowDirection, gap: 8 }}>
            <Pressable
              onPress={() => setSplitMode('even')}
              className="flex-1 items-center rounded-lg border py-3"
              style={{ borderColor: splitMode === 'even' ? colors.royalBlue : colors.border, backgroundColor: splitMode === 'even' ? colors.royalBlue : '#FFFFFF' }}
            >
              <Text className="text-center text-sm font-medium" style={{ color: splitMode === 'even' ? '#FFFFFF' : colors.ink }}>
                {t('billSummarySplitEquallyButton')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSplitMode('full')}
              className="flex-1 items-center rounded-lg border py-3"
              style={{ borderColor: splitMode === 'full' ? colors.royalBlue : colors.border, backgroundColor: splitMode === 'full' ? colors.royalBlue : '#FFFFFF' }}
            >
              <Text className="text-center text-sm font-medium" style={{ color: splitMode === 'full' ? '#FFFFFF' : colors.ink }}>
                {t('billSummaryPayFullForGroupButton')}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Tip — its own card, redesigned 2026-11-10 (explicit user
            decision, replacing the 2026-11-09 restaurant-policy version):
            no more on/off switch — the card is always offered, and the
            diner always makes an explicit choice (0% included) rather than
            starting from a restaurant-set default. Percent chips fixed at
            0/5/10/15/20/25 plus a free-amount option, same chip visual
            language as MenuBrowser.tsx's own FilterChip. */}
        <View className="mt-4 overflow-hidden rounded-xl bg-white px-4 py-3" style={{ borderColor: colors.border, borderWidth: 1 }}>
          {/* Bumped from text-sm to a dominant text-lg (2026-11-10, explicit
              request), same as billSummaryPaymentPreferenceTitle below. */}
          <Text className="text-lg font-bold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
            {t('billSummaryTipTitle')}
          </Text>
          {/* Encouraging explanation (2026-11-10, explicit request) in place
              of the old toggle-adjacent question — this app pools tips
              across the whole team (project_payments_and_cancellation_rules),
              so the copy speaks to that directly rather than a generic
              "want to tip?" prompt. "!" alert-circle in #38BDF8 (2026-11-10,
              explicit request) — this app's own established attention-mark
              convention for an informational note, not an error (same
              icon/color pairing this screen's own too-low-amount note uses
              further down, and AvailabilityNoticeBanner.tsx/MenuBrowser.tsx
              elsewhere). */}
          <View className="mt-1 items-start" style={{ flexDirection: rowDirection, gap: 5 }}>
            <Ionicons name="alert-circle" size={16} color="#38BDF8" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-xs leading-4" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
              {t('billSummaryTipEncouragementMessage')}
            </Text>
          </View>
          {/* "X סועדים נתנו טיפ היום" (2026-11-10, explicit request) — same
              real-data-only rule and exact styling as MenuBrowser.tsx's own
              dish order-activity line (colors.bottleGreen), never shown at
              zero. */}
          {tippersToday !== null && tippersToday > 0 && (
            <Text
              className="mt-1.5 text-[11px] font-medium"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{ color: colors.bottleGreen, textAlign: physicalReadingStart(isRTL) }}
            >
              {tippersToday === 1 ? t('billSummaryTipperCountSingularLabel') : t('billSummaryTipperCountLabel').replace('{count}', String(tippersToday))}
            </Text>
          )}
          {/* Real bug found live (2026-11-25, same report as tipBaseAmount's
              own comment above): once a friend is on this account, the tip
              base is a real choice, not something to silently assume either
              way — shown only once there's an actual combined total to
              choose between (myAccountMembers.length > 0), same visual
              language as the split-mode buttons above (selected = filled
              royalBlue). */}
          {myAccountMembers.length > 0 && (
            <View className="mt-3">
              <Text className="mb-1.5 text-xs font-semibold" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                {t('billSummaryTipBaseLabel')}
              </Text>
              <View style={{ flexDirection: rowDirection, gap: 8 }}>
                <Pressable
                  onPress={() => setTipBase('personal')}
                  className="flex-1 items-center rounded-lg border py-2.5"
                  style={{ borderColor: tipBase === 'personal' ? colors.royalBlue : colors.border, backgroundColor: tipBase === 'personal' ? colors.royalBlue : '#FFFFFF' }}
                >
                  <Text className="text-center text-sm font-medium" style={{ color: tipBase === 'personal' ? '#FFFFFF' : colors.ink }}>
                    {t('billSummaryTipBasePersonalButton')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTipBase('combined')}
                  className="flex-1 items-center rounded-lg border py-2.5"
                  style={{ borderColor: tipBase === 'combined' ? colors.royalBlue : colors.border, backgroundColor: tipBase === 'combined' ? colors.royalBlue : '#FFFFFF' }}
                >
                  <Text className="text-center text-sm font-medium" style={{ color: tipBase === 'combined' ? '#FFFFFF' : colors.ink }}>
                    {t('billSummaryTipBaseCombinedButton')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          <View className="mt-3">
            {/* Two "tabs" (2026-11-10, explicit request): tipMode==='percent'
                (the default) shows this one-row strip of all six chips —
                flex-1 each, not flexWrap, so all six always share exactly
                one row regardless of screen width, never wrapping to a
                second line. Tapping "סכום" below switches tipMode to
                'custom', which hides this whole row — not just visually
                dims it — in favor of the free-amount input underneath. */}
            {tipMode === 'percent' && (
              <View style={{ flexDirection: rowDirection, gap: 6 }}>
                {tipPercentOptions.map((percent) => {
                  const selected = tipPercent === percent;
                  return (
                    <Pressable
                      key={percent}
                      onPress={() => setTipPercent(percent)}
                      className="flex-1 items-center rounded-lg border py-2"
                      style={{ borderColor: selected ? colors.royalBlue : colors.border, backgroundColor: selected ? colors.royalBlue : '#FFFFFF' }}
                    >
                      <Text className="text-sm font-medium" style={{ color: selected ? '#FFFFFF' : colors.ink }}>{percent}%</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {/* The "סכום" tab itself — its own row below the percent strip
                (2026-11-10, explicit request), not a seventh chip mixed into
                that row. Sized to its own content (not full-width), aligned
                to the row's own reading-start side via a single-child flex
                row container — same technique already used elsewhere in
                this app for a non-stretching flex child (see i18n.tsx's own
                comment on why a literal alignSelf isn't trusted here).
                Tapping it while already selected used to toggle back to the
                percent tab (2026-11-10, user correction: not obvious to a
                diner — a double-tap-to-undo isn't a real affordance). A
                dedicated "אחוז טיפ" chip now appears alongside it once
                selected instead, an explicit, visible way back. */}
            <View className="mt-2" style={{ flexDirection: rowDirection, gap: 6 }}>
              {tipMode === 'custom' && (
                <Pressable
                  onPress={() => setTipMode('percent')}
                  className="items-center rounded-lg border px-3 py-2"
                  style={{ borderColor: colors.border, backgroundColor: '#FFFFFF' }}
                >
                  <Text className="text-sm font-medium" style={{ color: colors.ink }}>{t('billSummaryTipPercentChip')}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setTipMode('custom')}
                className="items-center rounded-lg border px-3 py-2"
                style={{ borderColor: tipMode === 'custom' ? colors.royalBlue : colors.border, backgroundColor: tipMode === 'custom' ? colors.royalBlue : '#FFFFFF' }}
              >
                <Text className="text-sm font-medium" style={{ color: tipMode === 'custom' ? '#FFFFFF' : colors.ink }}>
                  {t('billSummaryTipCustomAmountChip')}
                </Text>
              </Pressable>
            </View>
            {tipMode === 'custom' && (
              <TextInput
                value={tipCustomAmount}
                onChangeText={setTipCustomAmount}
                placeholder={t('billSummaryTipCustomAmountPlaceholder')}
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                className="mt-3 rounded-xl border px-4 py-3 text-sm"
                style={{ borderColor: colors.border, color: colors.ink, textAlign: physicalReadingStart(isRTL) }}
              />
            )}
            {/* Friendly, warm floor message (2026-11-10, explicit request) —
                shown only once the diner has actually typed something that
                doesn't clear the 5%-of-subtotal floor, not as a blocking
                error but as a quiet explanation; the pay button simply
                stays disabled underneath it in the meantime (hasChosenTip).
                "!" alert-circle in #38BDF8, this app's own established
                attention-mark convention for an informational note, not an
                error (see AvailabilityNoticeBanner.tsx/MenuBrowser.tsx's own
                addon-group hint for the same icon/color pairing). */}
            {tipMode === 'custom' && tipCustomAmount.trim() !== '' && !customTipMeetsMinimum && (
              <View className="mt-3 items-start" style={{ flexDirection: rowDirection, gap: 5 }}>
                <Ionicons name="alert-circle" size={18} color="#38BDF8" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-[11px] leading-4" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                  {t('billSummaryTipCustomAmountTooLowMessage')}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Payment preference — no row dividers, equal padding on every row
            (2026-11-08, explicit "symmetric spacing" request). Title moved
            inside the card itself (2026-11-10, explicit request — was a
            separate heading floating above it), matching how
            billSummaryTipTitle sits inside its own card above. */}
        <View className="mt-6 overflow-hidden rounded-xl bg-white px-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <Text className="pt-3 text-lg font-bold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
            {t('billSummaryPaymentPreferenceTitle')}
          </Text>
          <Pressable onPress={() => setPaymentMethod('card')} className="items-center py-3.5" style={{ flexDirection: rowDirection, gap: 10 }}>
            <Ionicons
              name={paymentMethod === 'card' ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={paymentMethod === 'card' ? colors.royalBlue : colors.textMuted}
            />
            <Text className="flex-1 text-sm" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
              {t('billSummaryCardLabel')}
            </Text>
          </Pressable>
          {/* pt-3.5 pb-1, not the symmetric py-3.5 every other row here
              uses (2026-11-08, explicit request to tighten the gap to the
              note right below it — this row's own bottom padding was the
              entire gap). */}
          <Pressable onPress={() => setPaymentMethod('cash')} className="items-center pb-1 pt-3.5" style={{ flexDirection: rowDirection, gap: 10 }}>
            <Ionicons
              name={paymentMethod === 'cash' ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={paymentMethod === 'cash' ? colors.royalBlue : colors.textMuted}
            />
            <Text className="flex-1 text-sm" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
              {t('billSummaryCashOption')}
            </Text>
          </Pressable>
          {/* Permanently visible (2026-11-08, explicit correction — no
              longer conditional on "מזומן" actually being selected).
              Indented to align with the "מ" of "מזומן" right above it, not
              the row's own edge: the radio row's icon (20) + its gap (10)
              is exactly how far that text starts from the edge, so this
              note gets the same inset instead of its own flush margin
              (2026-11-08, second explicit correction). Darker green
              (discountGreenDark, same shade as the discount badges'
              background elsewhere in this app) — plain `success` read as
              too light once it was no longer paired with a checkmark icon. */}
          <Text
            className="pb-3.5 text-xs font-semibold leading-4"
            style={{ color: colors.discountGreenDark, textAlign: physicalReadingStart(isRTL), [physicalReadingStart(isRTL) === 'right' ? 'marginRight' : 'marginLeft']: 30 }}
          >
            {t('billSummaryCashNote')}
          </Text>
          {/* pt-6, not the plain py-3.5 every other row here uses
              (2026-11-08, explicit request for more separation from the
              radio buttons/cash note above it). */}
          <Pressable onPress={() => setSmsReceipt((v) => !v)} className="items-center pb-3.5 pt-6" style={{ flexDirection: rowDirection, gap: 10 }}>
            <Ionicons name={smsReceipt ? 'checkbox' : 'square-outline'} size={20} color={smsReceipt ? colors.royalBlue : colors.textMuted} />
            <Text className="flex-1 text-sm" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
              {t('billSummarySmsReceiptLabel')}
            </Text>
          </Pressable>
        </View>

        {/* Pay button (2026-11-10, moved in here from a separate fixed bar
            below the scroll area — see KeyboardAwareScrollView's own
            comment above for why) — mt-4 fills in for that bar's own pt-3,
            insets.bottom already folded into the outer contentContainerStyle's
            own paddingBottom instead of repeated here. */}
        <View className="mt-4">
          {/* Required-choice hint (2026-11-10, explicit request): the button
              below stays disabled until the diner has picked a tip chip or a
              valid free amount — no default is ever pre-selected for them,
              0% included, so this explains why rather than leaving a
              disabled button unexplained. */}
          {/* Real bug found live (2026-11-25): see hasPendingRequest's own
              comment above — this is the explanation + way out, same "!"
              notice recipe as AvailabilityNoticeBanner.tsx/this screen's own
              tip-floor note (#38BDF8/#EAF6FD/#BAE6FD, never an invented
              color). Shown instead of the tip-required hint below when both
              would otherwise apply — the pending request is the one that
              actually needs acting on. */}
          {hasPendingRequest && (
            <View className="mb-3 items-center rounded-xl border px-3 py-2.5" style={{ backgroundColor: '#EAF6FD', borderColor: '#BAE6FD', position: 'relative' }}>
              {/* Countdown badge (2026-11-25, explicit user request) — fixed
                  physical bottom-left corner, not reading-direction-relative
                  (same "physical, not logical" choice as the approver's own
                  badge in GlobalBillingLinkListener). */}
              {pendingRequestCountdown !== null && (
                <View
                  className="items-center rounded-full"
                  style={{ position: 'absolute', bottom: 8, left: 8, flexDirection: 'row', gap: 3, backgroundColor: colors.royalBlue, paddingHorizontal: 8, paddingVertical: 3 }}
                >
                  <Ionicons name="timer-outline" size={12} color="#FFFFFF" />
                  <Text className="text-[11px] font-bold text-white">{formatCountdown(pendingRequestCountdown)}</Text>
                </View>
              )}
              <View className="w-full items-start" style={{ flexDirection: rowDirection, gap: 6 }}>
                <Ionicons name="alert-circle" size={18} color="#38BDF8" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-xs leading-4" style={{ color: '#1B2430', textAlign: physicalReadingStart(isRTL) }}>
                  {t('billSummaryPendingRequestBlocksPaymentMessage')}
                </Text>
              </View>
              <Pressable
                onPress={handleCancelPendingRequests}
                disabled={linkingFriends}
                className="mt-2.5 items-center rounded-lg border px-4 py-2"
                style={{ borderColor: colors.danger, opacity: linkingFriends ? 0.6 : 1 }}
              >
                <Text className="text-sm font-semibold" style={{ color: colors.danger }}>
                  {t('cancelPendingRequestButton')}
                </Text>
              </Pressable>
            </View>
          )}
          {!hasPendingRequest && !hasChosenTip && (
            <Text className="mb-2 text-center text-xs" style={{ color: colors.textMuted }}>
              {t('billSummaryTipRequiredHint')}
            </Text>
          )}
          <Pressable
            onPress={handlePayButtonPress}
            disabled={!hasChosenTip || closing || cashCalling || hasPendingRequest}
            className="items-center justify-center rounded-xl"
            style={{ backgroundColor: colors.royalBlue, minHeight: 48, opacity: !hasChosenTip || closing || cashCalling || hasPendingRequest ? 0.7 : 1 }}
          >
            <Text className="text-lg font-semibold text-white">{t('billSummaryPayButton')}</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <Modal visible={closeDoneOpen} transparent animationType="fade" onRequestClose={handleCloseDone}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5">
            <View className="mb-3 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: colors.successSoft }}>
              <Ionicons name="checkmark" size={26} color={colors.success} />
            </View>
            <Text className="mb-2 text-center text-lg font-bold text-[#1B2430]">
              {myFirstName ? `${t('endVisitDoneGreetingPrefix')}${myFirstName}!` : t('endVisitDoneGreetingFallback')}
            </Text>
            {/* Real bug found live (2026-11-09): this used to reuse
                endVisitDoneMessage ("your visit has ended") — the exact
                "end visit without ordering" copy, wrong for a payment
                confirmation. Dedicated message now, same as this screen's
                own real payment-completed notification (see
                confirm-card-payment/index.ts's own comment). */}
            <Text className="mb-5 text-center text-sm leading-5 text-[#6E6A61]">{t('billSummaryPaymentDoneMessage')}</Text>
            <Pressable onPress={handleCloseDone} className="w-full items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('gotIt')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ErrorModal
        visible={closeFailedMessage !== null}
        title={t('billSummaryCloseFailedTitle')}
        message={closeFailedMessage ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setCloseFailedMessage(null)}
      />

      {/* "הוספת חבר לחשבון האישי" (2026-11-15, real feature, replaces the
          carousel's own default "invite a new diner" behavior on this
          screen specifically — see ParticipantsRow's own onAddPress
          comment). Already-added members are fully interactive now (real
          bug found live: they used to be checked and disabled, so reopening
          this picker after adding someone had no way to undo it) —
          unchecking one removes them, see handleConfirmFriendPicker's own
          comment for how that's sent. */}
      <Modal visible={friendPickerOpen} transparent animationType="fade" onRequestClose={() => setFriendPickerOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-1 text-lg font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('addAccountMembersTitle')}
            </Text>
            <Text className="mb-4 text-sm leading-5 text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('addAccountMembersInstruction')}
            </Text>
            {eligibleFriends.length === 0 ? (
              <Text className="mb-2 py-4 text-center text-sm text-[#9CA3AF]">{t('addAccountMembersEmpty')}</Text>
            ) : (
              <>
                {/* "בחרו את כולם" (2026-11-15, explicit request) — only once
                    there's actually more than one friend to choose between;
                    a single eligible friend makes a select-all shortcut
                    meaningless. Acts as a master checkbox: checked (and
                    tapping it clears everyone) once every eligible friend is
                    already selected, otherwise selects everyone. */}
                {eligibleFriends.length > 1 &&
                  (() => {
                    const allSelected = eligibleFriends.every((f) => selectedFriendIds.has(f.participantId));
                    return (
                      <Pressable
                        onPress={() => setSelectedFriendIds(allSelected ? new Set() : new Set(eligibleFriends.map((f) => f.participantId)))}
                        className="items-center gap-3 pb-2.5"
                        style={{ flexDirection: rowDirection, borderBottomWidth: 1, borderColor: colors.border, marginBottom: 4 }}
                      >
                        <Ionicons name={allSelected ? 'checkbox' : 'square-outline'} size={22} color={allSelected ? colors.royalBlue : colors.textMuted} />
                        <Text className="flex-1 text-sm font-semibold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
                          {t('addAccountMembersSelectAll')}
                        </Text>
                      </Pressable>
                    );
                  })()}
                <ScrollView style={{ maxHeight: 280 }}>
                {eligibleFriends.map((friend) => {
                  const checked = selectedFriendIds.has(friend.participantId);
                  return (
                    <Pressable
                      key={friend.participantId}
                      onPress={() => toggleFriendSelected(friend.participantId)}
                      className="items-center gap-3 py-2.5"
                      style={{ flexDirection: rowDirection }}
                    >
                      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.royalBlue : colors.textMuted} />
                      {friend.photoUrl ? (
                        <Image source={{ uri: friend.photoUrl }} style={{ height: 32, width: 32, borderRadius: 16 }} />
                      ) : (
                        <View className="items-center justify-center rounded-full" style={{ height: 32, width: 32, backgroundColor: colors.royalBlue }}>
                          <Text className="text-xs font-bold text-white">{(friend.displayName ?? '?').charAt(0)}</Text>
                        </View>
                      )}
                      <Text className="flex-1 text-sm" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
                        {friend.displayName}
                      </Text>
                      {/* Real consent flow (2026-11-17) — a friend already
                          asked but who hasn't approved/declined yet reads
                          differently from one not asked at all, so a
                          re-opened picker doesn't look like nothing
                          happened. Unchecking this still cancels the
                          request, same as any other removal here. */}
                      {friend.pendingBillingRequestFrom === participantId && (
                        <Text className="text-xs" style={{ color: colors.textMuted }}>
                          {t('addAccountMembersPendingLabel')}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
                </ScrollView>
              </>
            )}
            <View className="mt-4" style={{ flexDirection: rowDirection, gap: 10 }}>
              <Pressable
                onPress={() => setFriendPickerOpen(false)}
                disabled={linkingFriends}
                className="flex-1 items-center rounded-lg border py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="font-semibold" style={{ color: colors.ink }}>
                  {t('back')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmFriendPicker()}
                disabled={linkingFriends || eligibleFriends.length === 0}
                className="flex-1 items-center rounded-lg py-3"
                style={{ backgroundColor: colors.royalBlue, opacity: linkingFriends || eligibleFriends.length === 0 ? 0.6 : 1 }}
              >
                <Text className="font-semibold text-white">{t('addAccountMembersConfirm')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ErrorModal
        visible={linkFriendsErrorMessage !== null}
        title={t('addAccountMembersFailedTitle')}
        message={linkFriendsErrorMessage ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setLinkFriendsErrorMessage(null)}
      />

      {/* "!" explanation for the add-members feature (2026-11-15, explicit
          request) — same modal shape as AccountScreen.tsx's own info modal
          (title + explanation + a single close button), just one topic
          instead of that one's four. */}
      <Modal visible={addFriendInfoOpen} transparent animationType="fade" onRequestClose={() => setAddFriendInfoOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-2 text-lg font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('addAccountMembersInfoTitle')}
            </Text>
            <Text className="text-sm leading-5 text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('addAccountMembersInfoExplanation')}
            </Text>
            <Pressable onPress={() => setAddFriendInfoOpen(false)} className="mt-5 items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('closeModal')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* The account isn't actually closed yet at this point (only staff
          confirming the cash payment settles it — see
          handlePayButtonPress's own comment), so dismissing this just goes
          back to the account screen rather than clearing the session the
          way handleCloseDone does for the card path. */}
      <CallWaiterModals
        called={cashCalled}
        error={cashError}
        onDismissCalled={() => {
          dismissCashCalled();
          goBackOrHome(router);
        }}
        onDismissError={dismissCashError}
        t={t}
      />
    </View>
  );
}
