import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CallWaiterInlineTrigger } from '../CallWaiterButton';
import { ConfirmModal } from '../ConfirmModal';
import { ErrorModal } from '../ErrorModal';
import { useI18n, visualRowDirection, physicalReadingStart } from '../../lib/i18n';
import { formatPrice } from '../../lib/formatPrice';
import { supabase } from '../../lib/supabase';
import { extractFunctionErrorCode } from '../../lib/functionError';
import { useTableSessionStore } from '../../lib/tableSessionStore';
import { colors } from '../../theme';
import { useAccountItems, type AccountItem } from './useAccountItems';
import { useSessionParticipants, type SessionParticipant } from './useSessionParticipants';
import { EndVisitReasonModal } from './EndVisitReasonModal';

type AccountSubTab = 'general' | 'personal';

// Not Number.toLocaleString() — Hermes' grouping/locale behavior isn't
// guaranteed consistent across devices, and this only ever needs one fixed
// format (comma thousands, 2 decimals), not the user's device locale. No
// trailing ".00" (2026-10-11, user request, applied app-wide) — a
// whole-number total reads cleaner without it; a non-zero fractional part
// still keeps its two decimals, same rule as formatPrice, just with comma
// grouping layered on top for this screen's bigger totals.
function formatAmount(amount: number): string {
  const [whole, decimals] = amount.toFixed(2).split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals === '00' ? groupedWhole : `${groupedWhole}.${decimals}`;
}

// The host's "מנהל/ת חשבון" status moved onto a small badge overlaid on
// the avatar's own bottom edge, instead of a text line below it
// (2026-10-19, user request — no name label under the avatar either, on
// reconsideration) — a star pill with a white ring, the same "badge
// pinned to an avatar's corner" pattern used for online/unread indicators
// elsewhere.
function ParticipantAvatar({ participant }: { participant: SessionParticipant }) {
  const initial = participant.displayName.trim().charAt(0).toUpperCase() || '?';
  return (
    <View className="items-center" style={{ width: 56 }}>
      <View style={{ position: 'relative' }}>
        {participant.photoUrl ? (
          <Image source={{ uri: participant.photoUrl }} style={{ height: 44, width: 44, borderRadius: 22 }} />
        ) : (
          <View className="items-center justify-center" style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: colors.royalBlue }}>
            <Text className="text-sm font-bold text-white">{initial}</Text>
          </View>
        )}
        {participant.isHost && (
          <View
            style={{
              position: 'absolute',
              bottom: -4,
              alignSelf: 'center',
              height: 16,
              width: 16,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              // Same green as the "+" add-participant button below
              // (2026-10-19, user request), not the royalBlue used
              // elsewhere for host/manager emphasis.
              backgroundColor: colors.success,
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
            }}
          >
            <Ionicons name="star" size={9} color="#FFFFFF" />
          </View>
        )}
      </View>
    </View>
  );
}

function ParticipantsRow({ participants }: { participants: SessionParticipant[] }) {
  const { isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const router = useRouter();
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const restaurantName = useTableSessionStore((s) => s.restaurantName);
  const tableId = useTableSessionStore((s) => s.tableId);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);
  const tableType = useTableSessionStore((s) => s.tableType);
  const sessionAccountNumber = useTableSessionStore((s) => s.sessionAccountNumber);
  const qrToken = useTableSessionStore((s) => s.qrToken);

  return (
    <View style={{ height: 76, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }}>
      {/* Real bug (2026-10-28, per explicit request): this ScrollView never
          set its own flexDirection at all, relying entirely on RN's
          horizontal-ScrollView default (a plain, never-mirrored 'row') to
          achieve the "+ renders last (leftmost under native RTL)" ordering
          described below — the exact native-mirroring assumption already
          disproven everywhere else in this app (see i18n.tsx's
          visualRowDirection comment): oldest participant was rendering
          physically LEFTMOST, "+" physically RIGHTMOST, the reverse of the
          intended order. Driven explicitly instead, same as every other
          row in this app. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: rowDirection, flexGrow: 1, alignItems: 'center', gap: 12, paddingHorizontal: 16 }}
      >
        {/* "+" renders last (leftmost, via rowDirection) — user request
            2026-10-10: "+" on the left of the list, oldest participant
            rightmost, each newly-added participant appearing just left of
            the existing list (i.e. closest to "+"). Relies on
            useSessionParticipants returning oldest-first. */}
        {participants.map((p) => (
          <ParticipantAvatar key={p.participantId} participant={p} />
        ))}
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/add-participants',
              params: { restaurantId, restaurantName, tableId, tableNumber, tableType: tableType ?? '', sessionId, sessionAccountNumber, qrToken },
            })
          }
          className="items-center justify-center rounded-full"
          style={{ height: 44, width: 44, backgroundColor: colors.success }}
        >
          <Ionicons name="add" size={26} color="#FFFFFF" />
        </Pressable>
      </ScrollView>
    </View>
  );
}

function AccountItemsTable({ scope, items, participants }: { scope: AccountSubTab; items: AccountItem[]; participants: SessionParticipant[] }) {
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const participantById = useMemo(() => new Map(participants.map((p) => [p.participantId, p])), [participants]);

  // Its own card now (2026-10-10, user request) — rounded/bordered/white,
  // matching the info-strip card above it, instead of sitting bare on the
  // screen's own background. The header row gets colors.background (the
  // screen's own tone) as its fill, so it reads as a distinct band within
  // the white card without introducing a new color. Each row gets its own
  // px-4 (rather than one shared padded wrapper) so the header's background
  // spans the card's full width, flush to its rounded corners.
  return (
    <View className="overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
      {items.length === 0 ? (
        <View className="items-center px-6 py-10">
          <Text className="text-sm text-[#9CA3AF]">{t('accountNoItemsYet')}</Text>
        </View>
      ) : (
        <>
          <View className="border-b px-4 py-2" style={{ flexDirection: rowDirection, borderColor: colors.border, backgroundColor: '#E6E6E6' }}>
            {scope === 'personal' && (
              <Text className="w-20 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnMember')}</Text>
            )}
            {/* Real bug (2026-10-28): the old comment here claimed 'left'
                was intentional because Android auto-mirrors textAlign
                gravity under forced RTL — but that auto-mirroring goes
                through the exact same I18nManager.isRTL flag this whole
                app's other RTL bugs this session trace back to being stuck
                on this device (see i18n.tsx's physicalReadingStart comment)
                — the same "assumes native mirroring works" mistake already
                found and fixed everywhere else (flexDirection, absolute
                position, even a horizontal ScrollView's own child order),
                just manifesting on textAlign instead. Computed explicitly
                instead, independent of that flag. */}
            <Text className="flex-[2] text-[11px] font-bold" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
              {t('accountColumnDescription')}
            </Text>
            <Text className="w-12 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnQuantity')}</Text>
            <Text className="flex-1 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnUnitPrice')}</Text>
            <Text className="flex-1 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnTotalPrice')}</Text>
          </View>
          {items.map((item, index) => {
            const member = participantById.get(item.participantId);
            return (
              <View
                key={item.id}
                className="items-center px-4 py-2.5"
                style={{ flexDirection: rowDirection, borderColor: colors.border, borderBottomWidth: index < items.length - 1 ? 1 : 0 }}
              >
                {scope === 'personal' && (
                  <View className="w-20 items-center">
                    {member?.photoUrl ? (
                      <Image source={{ uri: member.photoUrl }} style={{ height: 32, width: 32, borderRadius: 16 }} />
                    ) : (
                      <View className="items-center justify-center" style={{ height: 32, width: 32, borderRadius: 16, backgroundColor: colors.royalBlue }}>
                        <Text className="text-xs font-bold text-white">{(member?.displayName ?? '?').charAt(0)}</Text>
                      </View>
                    )}
                  </View>
                )}
                {/* Real bug (2026-10-28): same textAlign:'auto' issue as
                    this table's own header above. */}
                <Text className="flex-[2] text-sm text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {item.dishName}
                </Text>
                <Text className="w-12 text-center text-sm text-[#1B2430]">{item.quantity}</Text>
                <Text className="flex-1 text-center text-sm text-[#1B2430]" numberOfLines={1} adjustsFontSizeToFit>
                  ₪{formatPrice(item.unitPrice)}
                </Text>
                <Text className="flex-1 text-center text-sm text-[#1B2430]" numberOfLines={1} adjustsFontSizeToFit>
                  ₪{formatPrice(item.unitPrice * item.quantity)}
                </Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function StripCell({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const { isRTL } = useI18n();
  return (
    <View className="flex-1 items-center py-3">
      <Text className="text-[11px] text-[#9CA3AF]" numberOfLines={1} adjustsFontSizeToFit style={{ textAlign: 'center' }}>
        {label}
      </Text>
      <View className="mt-1 items-center gap-1" style={{ flexDirection: visualRowDirection(isRTL) }}>
        <Text className="text-base font-semibold text-[#1B2430]">{value}</Text>
        {icon && <Ionicons name={icon} size={12} color="#9CA3AF" />}
      </View>
    </View>
  );
}

// ניהול חשבון (מוקאפים 10.1/10.2, 2026-10-10) — replaces the placeholder
// AccountTabBody that only ever showed the number strip + "coming soon".
// The strip itself, and its info modal, are untouched from that placeholder
// per explicit instruction — only wrapped with the new content around it.
export function AccountScreen() {
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const clearTableSession = useTableSessionStore((s) => s.clearTableSession);
  const isBarTable = useTableSessionStore((s) => s.tableType === 'bar');
  // A bar session is shared by any number of unrelated diners (no capacity
  // cap, no relationship between them — see scan-qr/index.ts's own
  // comment), so "חשבון כללי" (everyone's items together) never applies to
  // it the way it does a real table of friends (2026-10-15, user decision):
  // always start on — and stay locked to — the personal view.
  const [subTab, setSubTab] = useState<AccountSubTab>(isBarTable ? 'personal' : 'general');
  const [infoOpen, setInfoOpen] = useState(false);
  const [billComingSoonOpen, setBillComingSoonOpen] = useState(false);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);
  const sessionAccountNumber = useTableSessionStore((s) => s.sessionAccountNumber);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  // The bar's personal "account" is its running pickup-ticket number
  // (0001-9999), not the usual random 6-digit sub_account_number — see
  // tableSessionStore.ts's own comment.
  const barTicketNumber = useTableSessionStore((s) => s.barTicketNumber);
  const personalAccountDisplay = isBarTable ? (barTicketNumber != null ? String(barTicketNumber).padStart(4, '0') : '—') : (subAccountNumber ?? '—');
  const reviewVerificationCode = useTableSessionStore((s) => s.reviewVerificationCode);
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);

  // Lifted here (2026-10-10) rather than fetched separately inside
  // AccountItemsTable — the bottom panel now needs the same total the table
  // shows, so both read from one fetch instead of two independent
  // subscriptions to the same session's data.
  const { items } = useAccountItems(sessionId);
  const { participants } = useSessionParticipants(sessionId);
  // Forced personal-only for a bar regardless of subTab state (defensive —
  // subTab is never actually set to 'general' for a bar since that tab
  // isn't rendered below, but this keeps the filter itself the single
  // source of truth rather than relying only on hidden UI).
  const visibleItems = isBarTable || subTab === 'personal' ? items.filter((i) => i.participantId === participantId) : items;
  const total = visibleItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  // Independent of subTab (2026-10-19, user request) — the bottom button's
  // own "can this diner leave with nothing owed" state is about *their*
  // personal balance specifically, not whichever total the table above
  // happens to be showing (viewing "חשבון כללי" with other participants'
  // unpaid items shouldn't make the button act as if this diner owes
  // something themselves).
  const personalTotal = items
    .filter((i) => i.participantId === participantId)
    .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const hasNothingToPay = personalTotal === 0;

  // "End visit without an order" flow (2026-10-19, user request): confirm
  // → pick a reason → personalized success — see leave-session Edge
  // Function for the real server-side action and its own zero-orders
  // guard (never trust this screen's own hasNothingToPay alone for
  // something that ends a diner's presence at the table).
  const [endVisitConfirmOpen, setEndVisitConfirmOpen] = useState(false);
  const [endVisitReasonOpen, setEndVisitReasonOpen] = useState(false);
  const [endVisitBusy, setEndVisitBusy] = useState(false);
  const [endVisitDoneOpen, setEndVisitDoneOpen] = useState(false);
  const [endVisitErrorMessage, setEndVisitErrorMessage] = useState<string | null>(null);
  const myFirstName = participants.find((p) => p.participantId === participantId)?.displayName.trim().split(/\s+/)[0] || null;

  async function handleEndVisitReasonConfirm(reason: string, reasonOther: string | null) {
    if (!sessionId || endVisitBusy) return;
    setEndVisitBusy(true);
    const { error } = await supabase.functions.invoke('leave-session', {
      body: { session_id: sessionId, reason, reason_other: reasonOther },
    });
    setEndVisitBusy(false);
    if (error) {
      const code = await extractFunctionErrorCode(error);
      setEndVisitReasonOpen(false);
      setEndVisitErrorMessage(code === 'HAS_PENDING_ORDERS' ? t('endVisitHasPendingOrdersMessage') : t('endVisitFailedMessage'));
      return;
    }
    setEndVisitReasonOpen(false);
    setEndVisitDoneOpen(true);
  }

  function handleEndVisitDone() {
    setEndVisitDoneOpen(false);
    clearTableSession();
    router.replace('/profile');
  }

  const infoRows: {
    labelKey: 'accountStripTableLabel' | 'accountStripGeneralLabel' | 'personalAccountNumberLabel' | 'lockedReviewCodeLabel';
    explanationKey: 'accountInfoTableExplanation' | 'accountInfoGeneralExplanation' | 'personalAccountNumberExplanation' | 'lockedReviewCodeExplanation';
  }[] = [
    { labelKey: 'accountStripTableLabel', explanationKey: 'accountInfoTableExplanation' },
    { labelKey: 'accountStripGeneralLabel', explanationKey: 'accountInfoGeneralExplanation' },
    { labelKey: 'personalAccountNumberLabel', explanationKey: 'personalAccountNumberExplanation' },
    { labelKey: 'lockedReviewCodeLabel', explanationKey: 'lockedReviewCodeExplanation' },
  ];

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <ParticipantsRow participants={participants} />

      {/* The general/personal toggle itself is meaningless for a bar — only
          personal ever applies (see isBarTable comments above) — so it's
          hidden entirely rather than shown with one dead/disabled option. */}
      {!isBarTable && (
      <View className="border-b bg-white" style={{ flexDirection: rowDirection, borderColor: colors.border }}>
        {(
          // Order matters: first JSX child renders rightmost via
          // visualRowDirection (real bug 2026-10-27: native RTL mirroring
          // alone can't be trusted — see i18n.tsx). User request 2026-10-10:
          // "חשבון אישי" on the right.
          [
            { key: 'personal' as const, labelKey: 'personalAccountTab' as const, icon: 'receipt-outline' as const },
            { key: 'general' as const, labelKey: 'generalAccountTab' as const, icon: 'reader-outline' as const },
          ]
        ).map((tab) => {
          const active = subTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setSubTab(tab.key)}
              className="flex-1 items-center justify-center gap-1.5 py-3"
              style={{ flexDirection: rowDirection, borderBottomWidth: active ? 2 : 0, borderColor: colors.royalBlue }}
            >
              <Ionicons name={tab.icon} size={16} color={active ? colors.royalBlue : '#9CA3AF'} />
              <Text className="text-sm font-semibold" style={{ color: active ? colors.royalBlue : '#9CA3AF' }}>
                {t(tab.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      )}

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pt-4">
          <View className="overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
            <View className="items-center justify-end px-3 pt-2" style={{ flexDirection: rowDirection }}>
              <Pressable
                onPress={() => setInfoOpen(true)}
                hitSlop={10}
                className="h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: '#38BDF8' }}
              >
                <Ionicons name="information-outline" size={14} color="#FFFFFF" />
              </Pressable>
            </View>
            <View className="items-stretch px-1 pb-3" style={{ flexDirection: rowDirection }}>
              <StripCell label={t('accountStripTableLabel')} value={tableNumber ?? '—'} />
              <View className="w-px" style={{ backgroundColor: colors.border }} />
              <StripCell label={t('accountStripGeneralLabel')} value={sessionAccountNumber ?? '—'} />
              <View className="w-px" style={{ backgroundColor: colors.border }} />
              <StripCell label={t('accountStripPersonalLabel')} value={personalAccountDisplay} />
              <View className="w-px" style={{ backgroundColor: colors.border }} />
              <StripCell label={t('accountStripCodeLabel')} value={reviewVerificationCode ?? '—'} icon="lock-closed" />
            </View>
          </View>
        </View>

        <View className="mt-4 px-4">
          <AccountItemsTable scope={subTab} items={visibleItems} participants={participants} />
        </View>
      </ScrollView>

      {/* Unified bottom panel (2026-10-10 redesign) — call-waiter trigger,
          the current total, the service-fee disclaimer, and the "הזמינו
          חשבון" CTA all live in one block, no separate background/border
          from the screen (kept from the previous round: colors.background,
          no border-top). */}
      <View className="px-4 pt-3" style={{ backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }}>
        <View className="items-center justify-between" style={{ flexDirection: rowDirection }}>
          <Text className="text-lg font-bold" style={{ color: colors.success }}>
            ₪{formatAmount(total)}
          </Text>
          {!isBarTable && <CallWaiterInlineTrigger />}
        </View>
        {/* Real bug (2026-10-28): plain full-width Text, same textAlign:
            'auto' issue found across the rest of the app — see i18n.tsx's
            physicalReadingStart comment. */}
        <Text className="mb-1 text-xs leading-4" style={{ color: colors.ink, textAlign: physicalReadingStart(isRTL) }}>
          {t('serviceFeeDisclaimerPrefix')}
          <Text style={{ fontWeight: '700' }}>{t('serviceFeeDisclaimerEmphasis')}</Text>
        </Text>

        {/* Plain static label, always shown, no conditional logic at all
            (2026-10-19, user request — explicitly not gated on balance or
            order history, unlike every earlier version of this line). Same
            shape as the service-fee disclaimer right above it — but
            centered, not right-aligned, per explicit request (2026-10-28). */}
        <Text className="mb-1 text-xs leading-4 text-center" style={{ color: colors.ink }}>
          {t('endVisitFreeTooltip')}
        </Text>

        {/* minHeight 48, not py-4 (2026-10-11, user request, follow-up: an
            interim py-3 then py-2 still didn't actually match the cart-
            summary bar's thickness — padding alone can't, since this
            button's text-lg label sits taller than that bar's text-sm one;
            an explicit shared height is what makes them line up) — matches
            CartBarInlineTrigger/placeOrderButton (MenuBrowser.tsx) exactly. */}
        <Pressable
          onPress={() => (hasNothingToPay ? setEndVisitConfirmOpen(true) : setBillComingSoonOpen(true))}
          className="items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.royalBlue, minHeight: 48 }}
        >
          <Text className="text-lg font-semibold text-white">{t(hasNothingToPay ? 'endVisitButton' : 'requestBillButton')}</Text>
        </Pressable>
      </View>

      <ConfirmModal
        visible={endVisitConfirmOpen}
        title={t('endVisitConfirmTitle')}
        message={t('endVisitConfirmMessage')}
        cancelLabel={t('endVisitConfirmBackButton')}
        confirmLabel={t('endVisitConfirmContinueButton')}
        onCancel={() => setEndVisitConfirmOpen(false)}
        onConfirm={() => {
          setEndVisitConfirmOpen(false);
          setEndVisitReasonOpen(true);
        }}
      />

      <EndVisitReasonModal
        visible={endVisitReasonOpen}
        busy={endVisitBusy}
        onBack={() => setEndVisitReasonOpen(false)}
        onConfirm={handleEndVisitReasonConfirm}
      />

      <Modal visible={endVisitDoneOpen} transparent animationType="fade" onRequestClose={handleEndVisitDone}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5">
            <View className="mb-3 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: colors.successSoft }}>
              <Ionicons name="checkmark" size={26} color={colors.success} />
            </View>
            <Text className="mb-2 text-center text-lg font-bold text-[#1B2430]">
              {myFirstName ? `${t('endVisitDoneGreetingPrefix')}${myFirstName}!` : t('endVisitDoneGreetingFallback')}
            </Text>
            <Text className="mb-5 text-center text-sm leading-5 text-[#6E6A61]">{t('endVisitDoneMessage')}</Text>
            <Pressable onPress={handleEndVisitDone} className="w-full items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('gotIt')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ErrorModal
        visible={endVisitErrorMessage !== null}
        title={t('endVisitFailedTitle')}
        message={endVisitErrorMessage ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setEndVisitErrorMessage(null)}
      />

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            {/* Real bug (2026-10-28): plain full-width Texts, same
                textAlign:'auto' issue found across the rest of the app —
                see i18n.tsx's physicalReadingStart comment. */}
            <Text className="mb-4 text-lg font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('accountInfoModalTitle')}
            </Text>
            {infoRows.map((row, i) => (
              <View key={row.labelKey} className={i > 0 ? 'mt-3.5' : ''}>
                <Text className="text-sm font-semibold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {t(row.labelKey)}
                </Text>
                <Text className="mt-0.5 text-xs leading-5 text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {t(row.explanationKey)}
                </Text>
              </View>
            ))}
            <Pressable onPress={() => setInfoOpen(false)} className="mt-5 items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('closeModal')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={billComingSoonOpen} transparent animationType="fade" onRequestClose={() => setBillComingSoonOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-2 text-lg font-bold text-[#1B2430]">{t('requestBillComingSoonTitle')}</Text>
            <Text className="mb-5 text-sm leading-5 text-[#6E6A61]">{t('requestBillComingSoonMessage')}</Text>
            <Pressable onPress={() => setBillComingSoonOpen(false)} className="items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('closeModal')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
