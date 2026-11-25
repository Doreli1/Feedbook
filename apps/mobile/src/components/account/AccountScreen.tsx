import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CallWaiterInlineTrigger } from '../CallWaiterButton';
import { ConfirmModal } from '../ConfirmModal';
import { ErrorModal } from '../ErrorModal';
import { useI18n, visualRowDirection, physicalReadingStart, physicalReadingEnd } from '../../lib/i18n';
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
// Exported (2026-11-08) — reused as-is by bill-summary.tsx's own "הוסיפו
// חבר לחשבון" teaser, so the two screens' avatars (host badge included) can
// never drift apart from each other.
export function ParticipantAvatar({
  participant,
  onRemove,
}: {
  participant: SessionParticipant;
  // Removal shortcut (2026-11-15, explicit request) — an X badge on the
  // avatar's lower corner, same exact styling/position as
  // add-participants.tsx's own deselect badge on its own selected-contacts
  // carousel (the real mockup reference named by the user). Only
  // bill-summary.tsx passes this (for a friend billed to the viewer's own
  // account, via ParticipantsRow's own removableParticipantIds) —
  // AccountScreen.tsx's own usage omits it, so its avatars are unaffected.
  onRemove?: () => void;
}) {
  const { isRTL } = useI18n();
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
        {onRemove && (
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={{
              position: 'absolute',
              bottom: -4,
              [physicalReadingEnd(isRTL)]: -4,
              height: 22,
              width: 22,
              borderRadius: 11,
              borderWidth: 2,
              borderColor: '#FFFFFF',
              backgroundColor: '#D1D5DB',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={13} color="#4B5563" />
          </Pressable>
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

// Exported (2026-11-08) — reused as-is by bill-summary.tsx (same avatar
// carousel, same right-to-left anchoring and ordering), per explicit user
// correction: that screen's own version used to center the avatars as one
// block instead of matching this row's actual alignment.
export function ParticipantsRow({
  participants,
  onAddPress,
  removableParticipantIds,
  onRemoveParticipant,
}: {
  participants: SessionParticipant[];
  // Overrides the "+" button's default behavior (2026-11-15, explicit
  // request) — bill-summary.tsx uses this to open its own "add a friend to
  // my personal account" picker instead of the normal invite-a-new-diner
  // flow below. Omitted everywhere else (AccountScreen.tsx), which keeps
  // the original behavior unchanged.
  onAddPress?: () => void;
  // X-badge removal shortcut straight from the carousel (2026-11-15,
  // explicit request, styled exactly like add-participants.tsx's own
  // deselect badge) — only bill-summary.tsx passes these, for whichever
  // avatars are currently billed to the viewer's own account; both omitted
  // everywhere else, so ParticipantAvatar's own onRemove stays undefined
  // and no badge renders.
  removableParticipantIds?: Set<string>;
  onRemoveParticipant?: (participantId: string) => void;
}) {
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

  // Fit/scroll-hint pass (2026-11-15, real issue found on a second physical
  // device — a narrower screen clipped the last avatar at the edge with
  // nothing suggesting it was scrollable, not shown). Two independent
  // pieces: the gap below was gently tightened (12→8) so the common case —
  // up to 4 participants + "+" — now fits inside ~324px of content, comfortably
  // within even a ~360px-wide phone; and the chevron hint below only
  // appears once content genuinely overflows the row's own width, via a
  // real measured comparison (not a guess at device size), so it never
  // misleads a solo diner with nothing to scroll to.
  const [rowWidth, setRowWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const isScrollable = contentWidth > rowWidth;

  return (
    <View
      style={{ height: 76, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }}
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
    >
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
        onContentSizeChange={(w) => setContentWidth(w)}
        contentContainerStyle={{ flexDirection: rowDirection, flexGrow: 1, alignItems: 'center', gap: 8, paddingHorizontal: 16 }}
      >
        {/* "+" renders last (leftmost, via rowDirection) — user request
            2026-10-10: "+" on the left of the list, oldest participant
            rightmost, each newly-added participant appearing just left of
            the existing list (i.e. closest to "+"). Relies on
            useSessionParticipants returning oldest-first. */}
        {participants.map((p) => (
          <ParticipantAvatar
            key={p.participantId}
            participant={p}
            onRemove={removableParticipantIds?.has(p.participantId) ? () => onRemoveParticipant?.(p.participantId) : undefined}
          />
        ))}
        <Pressable
          onPress={
            onAddPress ??
            (() =>
              router.push({
                pathname: '/add-participants',
                params: { restaurantId, restaurantName, tableId, tableNumber, tableType: tableType ?? '', sessionId, sessionAccountNumber, qrToken },
              }))
          }
          className="items-center justify-center rounded-full"
          style={{ height: 44, width: 44, backgroundColor: colors.success }}
        >
          {/* A distinct "add a person" glyph (2026-11-15, explicit request,
              reference: a WhatsApp group's own "צירוף חברים" icon) only when
              onAddPress is overridden — that's bill-summary.tsx's "add to my
              personal account" flow specifically, a different action from
              the plain "+" AccountScreen.tsx still uses for its own
              invite-a-new-diner flow below. */}
          <Ionicons name={onAddPress ? 'person-add' : 'add'} size={onAddPress ? 22 : 26} color="#FFFFFF" />
        </Pressable>
      </ScrollView>
      {/* Carousel hint (2026-11-15, explicit request) — a small chevron at
          the edge where the list actually overflows (physicalReadingStart:
          the oldest participant's own side, opposite "+" — see this row's
          own ordering comment above), only while isScrollable is true, so a
          solo diner with nothing to scroll never sees a misleading hint.
          pointerEvents="none" so it never steals the swipe gesture from the
          ScrollView underneath it. */}
      {isScrollable && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, bottom: 0, [physicalReadingStart(isRTL)]: 2, width: 22, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={physicalReadingStart(isRTL) === 'right' ? 'chevron-forward' : 'chevron-back'} size={14} color="#C7CCD1" />
        </View>
      )}
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
              // Fixed numeric width + flexShrink:0 via style, not the w-20
              // className — guarantees this column is really 80px and never
              // shrinks, matching the avatar wrapper below exactly. The
              // content inside this box really was centered all along (the
              // 2026-11-10 red-border diagnostic confirmed it) — the "leans
              // left" read was the column itself sitting flush against
              // "תיאור" with zero gap (no column gap is set on this row at
              // all) while the OUTER side keeps the row's own 16px px-4
              // padding, an asymmetry only this narrow a column made
              // noticeable. marginLeft (physical, matching this column's
              // own physical-left side — the one touching "תיאור") adds
              // that same breathing room on the inner side instead.
              <Text
                className="text-[11px] font-bold"
                style={{ width: 80, flexShrink: 0, marginLeft: 10, textAlign: 'center', color: colors.ink }}
              >
                {t('accountColumnMember')}
              </Text>
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
            {/* Shortened to "מחיר ליח'" (2026-11-10, user report): the extra
                w-20 member column (personal tab only) narrows this flex-1
                share enough that the full "מחיר ליחידה" wrapped to two
                lines — adjustsFontSizeToFit was tried and rejected (same
                report: made every header an inconsistent, too-small size).
                A shorter label at the same fixed size the other headers
                keep is the fix that doesn't touch layout or font size. */}
            <Text className="flex-1 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnUnitPrice')}</Text>
            <Text className="flex-1 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnTotalPrice')}</Text>
          </View>
          {scope === 'personal' ? (
            // Merged member-avatar "cell" (2026-11-15, explicit request —
            // Excel-style vertical cell merge). Every row in the personal
            // tab is this one diner's own item (visibleItems filters to
            // participantId === the viewer, AccountScreen.tsx), so the old
            // per-row avatar was the identical image repeated on every
            // single line — pure noise, per the user's own screenshot. One
            // avatar now spans the full height of the rows beside it
            // instead: alignItems:'stretch' is this row's own default
            // cross-axis behavior, so the avatar box naturally stretches to
            // match the content column's total height with no explicit
            // height math, and justifyContent:'center' centers the avatar
            // within that stretched height. Horizontal padding moves from
            // each row (px-4) to this outer wrapper, since the avatar is no
            // longer part of each row's own flex layout.
            <View style={{ flexDirection: rowDirection, paddingHorizontal: 16 }}>
              <View style={{ width: 80, flexShrink: 0, marginLeft: 10, alignItems: 'center', justifyContent: 'center' }}>
                {(() => {
                  const member = participantById.get(items[0].participantId);
                  return member?.photoUrl ? (
                    <Image source={{ uri: member.photoUrl }} style={{ height: 32, width: 32, borderRadius: 16 }} />
                  ) : (
                    <View className="items-center justify-center" style={{ height: 32, width: 32, borderRadius: 16, backgroundColor: colors.royalBlue }}>
                      <Text className="text-xs font-bold text-white">{(member?.displayName ?? '?').charAt(0)}</Text>
                    </View>
                  );
                })()}
              </View>
              <View style={{ flex: 1 }}>
                {items.map((item, index) => (
                  <View
                    key={item.id}
                    className="items-center py-2.5"
                    style={{ flexDirection: rowDirection, borderColor: colors.border, borderBottomWidth: index < items.length - 1 ? 1 : 0 }}
                  >
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
                ))}
              </View>
            </View>
          ) : (
            items.map((item, index) => (
              <View
                key={item.id}
                className="items-center px-4 py-2.5"
                style={{ flexDirection: rowDirection, borderColor: colors.border, borderBottomWidth: index < items.length - 1 ? 1 : 0 }}
              >
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
            ))
          )}
        </>
      )}
    </View>
  );
}

// Exported (2026-11-08) — reused as-is by bill-summary.tsx's own account/
// table/guest-name card, per explicit request to style it "like it's styled
// in ניהול חשבון" rather than approximate it with a different layout.
export function StripCell({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const { isRTL } = useI18n();
  return (
    <View className="flex-1 items-center py-3">
      {/* Bumped from text-[11px] to text-sm (2026-11-10, explicit request)
          — shared by every screen that uses this cell (AccountScreen.tsx's
          own strip, bill-summary.tsx's account/table/guest-name strip), so
          the increase applies everywhere, not just one of them. */}
      <Text className="text-sm text-[#9CA3AF]" numberOfLines={1} adjustsFontSizeToFit style={{ textAlign: 'center' }}>
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
  // Real bug found live (2026-11-17, user report): a diner who already paid
  // and left (left_at set, by confirm-card-payment) kept showing up in this
  // screen's own avatar carousel as if still an active table-mate. Scoped
  // to just the carousel — AccountItemsTable below still gets the full,
  // unfiltered `participants` so a departed diner's own past order rows
  // keep resolving to their real name/avatar instead of "?".
  const activeParticipants = participants.filter((p) => p.leftAt === null);
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

  // Real consent flow (2026-11-17, explicit request): once this diner has
  // approved someone else's request to add them, THEIR "סגרו חשבון" button
  // here stops meaning "go pay" — tapping it now explains who's paying and
  // offers a way back to paying independently, instead of pushing
  // bill-summary for a bill that isn't this diner's own to settle anymore.
  const me = participants.find((p) => p.participantId === participantId);
  const billedToParticipantId = me?.billedToParticipantId ?? null;
  const billedToPayer = billedToParticipantId ? (participants.find((p) => p.participantId === billedToParticipantId) ?? null) : null;
  const [billedToInfoOpen, setBilledToInfoOpen] = useState(false);
  const [cancellingBillingLink, setCancellingBillingLink] = useState(false);
  const [cancelBillingLinkErrorMessage, setCancelBillingLinkErrorMessage] = useState<string | null>(null);

  async function handleCancelBillingLink() {
    if (!sessionId || cancellingBillingLink) return;
    setCancellingBillingLink(true);
    const { error } = await supabase.functions.invoke('respond-to-personal-account-link', {
      body: { session_id: sessionId, action: 'decline' },
    });
    setCancellingBillingLink(false);
    if (error) {
      setCancelBillingLinkErrorMessage(t('billingLinkCancelFailedMessage'));
      return;
    }
    setBilledToInfoOpen(false);
  }

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
      <ParticipantsRow participants={activeParticipants} />

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
        {/* The total used to live in this row too (2026-11-10, user
            request: moved into the button below instead, as a white
            counter-style badge) — this row is now only the call-waiter
            trigger, so it's skipped entirely at the bar, where that trigger
            never renders either. */}
        {!isBarTable && (
          <View className="items-center justify-end" style={{ flexDirection: rowDirection }}>
            <CallWaiterInlineTrigger />
          </View>
        )}
        {/* Plain static label, always shown, no conditional logic at all
            (2026-10-19, user request — explicitly not gated on balance or
            order history, unlike every earlier version of this line).
            Centered, not right-aligned, per explicit request (2026-10-28). */}
        <Text className="mb-1 text-xs leading-4 text-center" style={{ color: colors.ink }}>
          {t('endVisitFreeTooltip')}
        </Text>

        {/* minHeight 48, not py-4 (2026-10-11, user request, follow-up: an
            interim py-3 then py-2 still didn't actually match the cart-
            summary bar's thickness — padding alone can't, since this
            button's text-lg label sits taller than that bar's text-sm one;
            an explicit shared height is what makes them line up) — matches
            CartBarInlineTrigger/placeOrderButton (MenuBrowser.tsx) exactly.
            The total (2026-11-10, user request) sits in here as a white
            counter-style badge, same shape as CartBarInlineTrigger's own
            item-count badge — absolutely positioned on the physical left
            (hardcoded `left`, not a logical start/end prop — see i18n.tsx's
            own comment on why those are unreliable here) so the label stays
            truly centered in the button instead of sharing a flex row with
            it (2026-11-10, user correction: justify-between pushed the
            label off-center). Badge text color matches the button's own
            background (colors.royalBlue), not green, per explicit request. */}
        <Pressable
          // Temporary stand-in for Stage 6's real payment flow (2026-11-08,
          // explicit user request): pushes the real bill-summary screen —
          // see that screen's own top comment — instead of a plain "coming
          // soon" modal, which used to render here unconditionally.
          // Real consent flow (2026-11-17) — once billedToParticipantId is
          // set, this diner approved someone else paying for them; tapping
          // the (visually dimmed) button now explains that instead of
          // pushing them into a bill-summary flow that isn't theirs to pay
          // anymore.
          onPress={() => {
            if (billedToParticipantId) {
              setBilledToInfoOpen(true);
              return;
            }
            hasNothingToPay ? setEndVisitConfirmOpen(true) : router.push('/bill-summary');
          }}
          className="items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.royalBlue, minHeight: 48, opacity: billedToParticipantId ? 0.5 : 1 }}
        >
          <Text className="text-lg font-semibold text-white">
            {t(billedToParticipantId ? 'billedToSomeoneElseButton' : hasNothingToPay ? 'endVisitButton' : 'requestBillButton')}
          </Text>
          {/* top:0/bottom:0 (2026-11-10, user report) stretched this to the
              button's full 48px height instead of a compact chip — a fixed
              height + top:'50%'/marginTop:-half is the deterministic RN way
              to center an absolutely-positioned element without stretching
              it to fill its positioned ancestor. */}
          <View
            className="items-center justify-center rounded-full bg-white px-3"
            style={{ position: 'absolute', left: 12, top: '50%', height: 24, marginTop: -12 }}
          >
            {/* Split into two Text runs with a gap, not a literal "₪
                {price}" space (2026-11-10, user request for spacing) — same
                real bidi bug CartBarInlineTrigger's own price already hit
                and fixed this exact way (see its comment): a space
                character between ₪ and the number lets the bidi algorithm
                reorder them wrong. Number first in source, ₪ second. */}
            <View className="items-center" style={{ flexDirection: rowDirection, gap: 4 }}>
              <Text className="text-base font-bold" style={{ color: colors.royalBlue }}>
                {formatAmount(total)}
              </Text>
              <Text className="text-base font-bold" style={{ color: colors.royalBlue }}>
                ₪
              </Text>
            </View>
          </View>
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

      {/* Real consent flow (2026-11-17, explicit request) — explains who's
          paying for this diner's own account and offers a real way back to
          paying independently, since the close-account button above no
          longer does its normal job while this is active. */}
      <Modal visible={billedToInfoOpen} transparent animationType="fade" onRequestClose={() => setBilledToInfoOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5">
            {billedToPayer?.photoUrl ? (
              <Image source={{ uri: billedToPayer.photoUrl }} style={{ height: 56, width: 56, borderRadius: 28, marginBottom: 12 }} />
            ) : (
              <View className="mb-3 items-center justify-center rounded-full" style={{ height: 56, width: 56, backgroundColor: colors.royalBlue }}>
                <Text className="text-lg font-bold text-white">{(billedToPayer?.displayName ?? '?').charAt(0)}</Text>
              </View>
            )}
            <Text className="mb-2 text-center text-lg font-bold text-[#1B2430]">
              {t('billingLinkInfoTitle').replace('{name}', billedToPayer?.displayName ?? '')}
            </Text>
            <Text className="mb-5 text-center text-sm leading-5 text-[#6E6A61]">
              {t('billingLinkInfoMessage').replace('{name}', billedToPayer?.displayName ?? '').replace('{account}', personalAccountDisplay)}
            </Text>
            <Pressable
              onPress={() => void handleCancelBillingLink()}
              disabled={cancellingBillingLink}
              className="w-full items-center rounded-lg border py-3"
              style={{ borderColor: colors.danger, opacity: cancellingBillingLink ? 0.6 : 1 }}
            >
              <Text className="font-semibold" style={{ color: colors.danger }}>
                {t('billingLinkCancelButton')}
              </Text>
            </Pressable>
            <Pressable onPress={() => setBilledToInfoOpen(false)} className="mt-2 w-full items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('closeModal')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ErrorModal
        visible={cancelBillingLinkErrorMessage !== null}
        title={t('billingLinkCancelFailedTitle')}
        message={cancelBillingLinkErrorMessage ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setCancelBillingLinkErrorMessage(null)}
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
    </View>
  );
}
