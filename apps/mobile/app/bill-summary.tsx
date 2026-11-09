import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
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
import { goBackOrHome } from '../src/lib/goBackOrHome';
import { useI18n, visualRowDirection, physicalReadingStart } from '../src/lib/i18n';
import { formatPrice } from '../src/lib/formatPrice';
import { supabase } from '../src/lib/supabase';
import { useTableSessionStore } from '../src/lib/tableSessionStore';
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
// Three pieces are honest placeholders, not hidden gaps (same "show the
// real state, don't fake what isn't built" approach as add-participants.tsx):
// the SMS-receipt checkbox is local UI state only — no real SMS sending;
// "חלקו את התשלום שווה" is visual-only for now (opens a "coming soon" modal
// on tap), per explicit instruction when this screen was first scoped; and
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
// A real tip, diner-controlled and able to be switched off entirely,
// doesn't have that problem.
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
  // Same fallback as AccountScreen.tsx's own personalAccountDisplay — a bar
  // diner's "personal account" is their pickup-ticket number, not
  // subAccountNumber (see tableSessionStore.ts's own comment).
  const personalAccountDisplay = isBarTable ? (barTicketNumber != null ? String(barTicketNumber).padStart(4, '0') : '—') : (subAccountNumber ?? '—');

  const { items } = useAccountItems(sessionId);
  const { participants } = useSessionParticipants(sessionId);

  const me = participants.find((p) => p.participantId === participantId);
  const myFirstName = me?.displayName.trim().split(/\s+/)[0] || null;
  // Oldest-first (useSessionParticipants's own convention, see
  // ParticipantsRow's comment) — this diner's own position in that order is
  // the closest honest meaning of "סועד 1/2/3..." the real mockup shows,
  // short of a real seat-numbering feature that doesn't exist.
  const myIndex = participants.findIndex((p) => p.participantId === participantId);
  const dinerNumber = myIndex >= 0 ? myIndex + 1 : 1;

  const subtotal = items.filter((i) => i.participantId === participantId).reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  // Restaurant-configured tip policy (2026-11-09, explicit request — Web
  // Admin's RestaurantDetailsForm.tsx, its own "מדיניות טיפים" section).
  // tipPolicyEnabled hides the whole tip card below when the restaurant
  // doesn't solicit tips at all — not just a disabled control, the card
  // simply isn't offered. When it IS enabled, minimumTipPercent (5-10 on
  // the admin side) is the floor the quick-select chips generate from, in
  // the same steps of 5 as before. Live, not just fetched once on mount
  // (2026-11-09, explicit follow-up request) — subscribed via Realtime so
  // a staff member changing either setting while this diner's screen is
  // already open takes effect immediately, the same way restaurant-status
  // changes already do elsewhere in this app (e.g. AvailabilityNoticeBanner's
  // own restaurant-status channel). `restaurants` is already in the
  // supabase_realtime publication (20261102100500_realtime_publication_
  // restaurants.sql), so no further backend change was needed for this.
  const [tipPolicyEnabled, setTipPolicyEnabled] = useState(true);
  const [minimumTipPercent, setMinimumTipPercent] = useState(10);
  useEffect(() => {
    if (!restaurantId) return;
    const id = restaurantId;
    let cancelled = false;
    async function refreshTipPolicy() {
      const { data } = await supabase.from('restaurants').select('tip_policy_enabled, minimum_tip_percent').eq('id', id).maybeSingle();
      if (cancelled || !data) return;
      setTipPolicyEnabled(data.tip_policy_enabled);
      setMinimumTipPercent(data.minimum_tip_percent);
    }
    void refreshTipPolicy();

    const channel = supabase
      .channel(`bill-summary-tip-policy-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${id}` }, () => void refreshTipPolicy())
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const [tipEnabled, setTipEnabled] = useState(true);
  const [tipMode, setTipMode] = useState<'percent' | 'custom'>('percent');
  // null = the diner hasn't picked a chip yet — falls back to the
  // restaurant's own floor (minimumTipPercent) below, so the default
  // selection always tracks that value once it loads instead of being
  // stuck at whatever this state happened to initialize to before the
  // (async) fetch resolved.
  const [tipPercent, setTipPercent] = useState<number | null>(null);
  const effectiveTipPercent = tipPercent ?? minimumTipPercent;
  const [tipCustomAmount, setTipCustomAmount] = useState('');
  const tipAmount = !tipPolicyEnabled || !tipEnabled ? 0 : tipMode === 'percent' ? subtotal * (effectiveTipPercent / 100) : Number(tipCustomAmount.replace(',', '.')) || 0;
  const total = subtotal + tipAmount;

  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('card');
  const [smsReceipt, setSmsReceipt] = useState(false);
  const [splitComingSoonOpen, setSplitComingSoonOpen] = useState(false);
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
    const { error } = await supabase.functions.invoke('confirm-card-payment', { body: { session_id: sessionId, tip_amount: tipAmount } });
    setClosing(false);
    if (error) {
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

  // Four chips starting at the restaurant's own floor, in steps of 5
  // (2026-11-09) — was a flat, restaurant-agnostic 10/15/20/25 before.
  const tipChips: { key: 'percent' | 'custom'; percent?: number }[] = [
    { key: 'percent', percent: minimumTipPercent },
    { key: 'percent', percent: minimumTipPercent + 5 },
    { key: 'percent', percent: minimumTipPercent + 10 },
    { key: 'percent', percent: minimumTipPercent + 15 },
    { key: 'custom' },
  ];

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

      {/* Identical to AccountScreen.tsx's own avatar carousel (2026-11-08,
          explicit correction — a centered block before this didn't match
          it): same component, same right-to-left anchoring, same "+" at the
          reading-start end. */}
      <ParticipantsRow participants={participants} />

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <Text className="mb-4 text-center text-xs" style={{ color: colors.textMuted }}>
          {t('billSummaryAddFriendCaption')}
        </Text>

        {/* Same StripCell + card chrome as AccountScreen.tsx's own number
            strip (2026-11-08, explicit request to match its styling
            exactly, not approximate it). */}
        <View className="overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <View className="items-stretch px-1 py-2" style={{ flexDirection: rowDirection }}>
            <StripCell label={t('billSummaryAccountLabel')} value={sessionAccountNumber ?? '—'} />
            <View className="w-px" style={{ backgroundColor: colors.border }} />
            <StripCell label={t('billSummaryTableNumberLabel')} value={tableNumber ?? '—'} />
            <View className="w-px" style={{ backgroundColor: colors.border }} />
            <StripCell label={t('billSummaryGuestNameLabel')} value={me?.displayName ?? '—'} />
          </View>
        </View>

        {/* Price breakdown — no row dividers, bigger text (2026-11-08,
            explicit request). */}
        <View className="mt-4 overflow-hidden rounded-xl bg-white px-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <View className="items-center justify-between py-3.5" style={{ flexDirection: rowDirection }}>
            <Text className="text-base" style={{ color: colors.ink }}>
              {t('billSummaryDinerLineLabel').replace('{n}', String(dinerNumber))}
            </Text>
            <Text className="text-base font-semibold" style={{ color: colors.ink }}>
              ₪{formatPrice(subtotal)}
            </Text>
          </View>
          {tipPolicyEnabled && tipEnabled && (
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

        {/* Rectangular, rounded corners — not a pill (2026-11-08, explicit
            correction). */}
        <Pressable
          onPress={() => setSplitComingSoonOpen(true)}
          className="mt-4 items-center justify-center rounded-xl py-3"
          style={{ backgroundColor: colors.royalBlue }}
        >
          <Text className="text-sm font-semibold text-white">{t('billSummarySplitEquallyButton')}</Text>
        </Pressable>

        {/* Tip — its own card, toggle defaults to on (2026-11-08, explicit
            request). Percent chips 10/15/20/25 plus a free-amount option,
            same chip visual language as MenuBrowser.tsx's own FilterChip.
            The whole card is skipped (2026-11-09) when the restaurant's own
            "מדיניות טיפים" is off — not shown disabled, simply not offered. */}
        {tipPolicyEnabled && (
        <View className="mt-4 overflow-hidden rounded-xl bg-white px-4 py-3" style={{ borderColor: colors.border, borderWidth: 1 }}>
          {/* Encouraging microcopy question (2026-11-08, explicit request)
              in place of a bare "טיפ:" label — the toggle itself answers it. */}
          <View className="items-center justify-between" style={{ flexDirection: rowDirection, gap: 10 }}>
            <Text className="flex-1 text-sm font-semibold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
              {t('billSummaryTipQuestion')}
            </Text>
            <Switch value={tipEnabled} onValueChange={setTipEnabled} trackColor={{ false: colors.border, true: colors.royalBlue }} thumbColor="#FFFFFF" />
          </View>
          {tipEnabled && (
            <View className="mt-3">
              <View className="items-center" style={{ flexDirection: rowDirection, flexWrap: 'wrap', gap: 8 }}>
                {tipChips.map((chip) => {
                  const selected = chip.key === 'percent' ? tipMode === 'percent' && effectiveTipPercent === chip.percent : tipMode === 'custom';
                  return (
                    <Pressable
                      key={chip.key === 'percent' ? `p${chip.percent}` : 'custom'}
                      onPress={() => {
                        if (chip.key === 'percent' && chip.percent !== undefined) {
                          setTipMode('percent');
                          setTipPercent(chip.percent);
                        } else {
                          setTipMode('custom');
                        }
                      }}
                      className="items-center rounded-lg border px-3 py-2"
                      style={{ borderColor: selected ? colors.royalBlue : colors.border, backgroundColor: selected ? colors.royalBlue : '#FFFFFF' }}
                    >
                      <Text className="text-sm font-medium" style={{ color: selected ? '#FFFFFF' : colors.ink }}>
                        {chip.key === 'percent' ? `${chip.percent}%` : t('billSummaryTipCustomAmountChip')}
                      </Text>
                    </Pressable>
                  );
                })}
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
              {/* 2026-11-09, explicit request — the chips above are no
                  longer a fixed, app-wide range (see minimumTipPercent's
                  own comment); this tells the diner why, instead of
                  leaving a restaurant-specific range unexplained. "!"
                  alert-circle in #38BDF8 (2026-11-09, explicit request) —
                  this app's own established attention-mark convention for
                  an informational note, not an error (see
                  AvailabilityNoticeBanner.tsx/MenuBrowser.tsx's own addon-
                  group hint for the same icon/color pairing). */}
              <View className="mt-3 items-start" style={{ flexDirection: rowDirection, gap: 5 }}>
                <Ionicons name="alert-circle" size={18} color="#38BDF8" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-[11px] leading-4" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                  {t('billSummaryTipPolicyNote')}
                </Text>
              </View>
            </View>
          )}
        </View>
        )}

        {/* Payment preference — no row dividers, equal padding on every row
            (2026-11-08, explicit "symmetric spacing" request). */}
        <Text className="mb-2 mt-6 text-sm font-bold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
          {t('billSummaryPaymentPreferenceTitle')}
        </Text>
        <View className="overflow-hidden rounded-xl bg-white px-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
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
      </ScrollView>

      <View className="px-4 pt-3" style={{ backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }}>
        <Pressable
          onPress={handlePayButtonPress}
          disabled={closing || cashCalling}
          className="items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.royalBlue, minHeight: 48, opacity: closing || cashCalling ? 0.7 : 1 }}
        >
          <Text className="text-lg font-semibold text-white">{t('billSummaryPayButton')}</Text>
        </Pressable>
      </View>

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

      <Modal visible={splitComingSoonOpen} transparent animationType="fade" onRequestClose={() => setSplitComingSoonOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-2 text-lg font-bold text-[#1B2430]">{t('billSummarySplitComingSoonTitle')}</Text>
            <Text className="mb-5 text-sm leading-5 text-[#6E6A61]">{t('billSummarySplitComingSoonMessage')}</Text>
            <Pressable onPress={() => setSplitComingSoonOpen(false)} className="items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
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
