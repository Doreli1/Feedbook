import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CallWaiterInlineTrigger } from '../CallWaiterButton';
import { ConfirmModal } from '../ConfirmModal';
import { ErrorModal } from '../ErrorModal';
import { useI18n } from '../../lib/i18n';
import { formatPrice } from '../../lib/formatPrice';
import { supabase } from '../../lib/supabase';
import { extractFunctionErrorCode } from '../../lib/functionError';
import { useTableSessionStore } from '../../lib/tableSessionStore';
import { colors } from '../../theme';
import { useAccountItems, type AccountItem } from './useAccountItems';
import { useSessionParticipants, type SessionParticipant } from './useSessionParticipants';

// Same 5-minute window as OrderTracker.tsx/update-order-item's own
// EDIT_WINDOW_MINUTES — duplicated here on purpose, matching that existing
// convention (each caller keeps its own copy for a value this stable, see
// that Edge Function's own comment).
const EDIT_WINDOW_MINUTES = 5;

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

function ParticipantAvatar({ participant }: { participant: SessionParticipant }) {
  const { t } = useI18n();
  const initial = participant.displayName.trim().charAt(0).toUpperCase() || '?';
  return (
    <View className="items-center" style={{ width: 56 }}>
      {participant.photoUrl ? (
        <Image source={{ uri: participant.photoUrl }} style={{ height: 44, width: 44, borderRadius: 22 }} />
      ) : (
        <View className="items-center justify-center" style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: colors.royalBlue }}>
          <Text className="text-sm font-bold text-white">{initial}</Text>
        </View>
      )}
      {participant.isHost && (
        <Text className="mt-1 text-center text-[10px] text-[#9CA3AF]" numberOfLines={1} adjustsFontSizeToFit>
          {t('accountManagerLabel')}
        </Text>
      )}
    </View>
  );
}

function ParticipantsRow({ participants }: { participants: SessionParticipant[] }) {
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', gap: 12, paddingHorizontal: 16 }}
      >
        {/* "+" renders last (leftmost under native RTL — first JSX child is
            rightmost) — user request 2026-10-10: "+" on the left of the
            list, oldest participant rightmost, each newly-added participant
            appearing just left of the existing list (i.e. closest to "+").
            Relies on useSessionParticipants returning oldest-first. */}
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
  const { t } = useI18n();
  const participantById = useMemo(() => new Map(participants.map((p) => [p.participantId, p])), [participants]);
  // Removing a priced modifier (2026-10-11, user request) — the row stays
  // visible here (no local filtering), the realtime subscription already
  // owned by useAccountItems picks up the resulting order_items change and
  // refetches on its own once the PATCH below actually lands.
  const [removeTarget, setRemoveTarget] = useState<AccountItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemoveModifier() {
    if (!removeTarget?.removable) return;
    const { error } = await supabase.functions.invoke('update-order-item', {
      method: 'PATCH',
      body: {
        order_item_id: removeTarget.removable.orderItemId,
        action: 'update',
        quantity: removeTarget.quantity,
        dish_size_option_id: removeTarget.removable.dishSizeOptionId,
        modifier_selections: removeTarget.removable.otherModifierSelections.map((m) => ({
          modifier_option_id: m.modifierOptionId,
          serving_variant_id: m.servingVariantId,
        })),
      },
    });
    setRemoveTarget(null);
    if (error) {
      const code = await extractFunctionErrorCode(error);
      if (code === 'EDIT_WINDOW_EXPIRED') setRemoveError(t('editWindowExpiredMessage'));
      else if (code === 'ITEM_ALREADY_READY') setRemoveError(t('itemAlreadyReadyMessage'));
      else setRemoveError(t('placeOrderFailedMessage'));
    }
  }

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
          <View className="flex-row border-b px-4 py-2" style={{ borderColor: colors.border, backgroundColor: '#E6E6E6' }}>
            {scope === 'personal' && (
              <Text className="w-20 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnMember')}</Text>
            )}
            {/* textAlign: 'left' here is intentional, not a typo — under this
                app's forced RTL (I18nManager.forceRTL), Android maps RN's
                literal 'left'/'right' textAlign to native gravity, which
                Android itself then auto-mirrors to start/end under RTL
                layout direction, inverting it back to physical right. 'right'
                rendered physically left; this renders physically right. */}
            <Text className="flex-[2] text-[11px] font-bold" style={{ color: colors.ink, textAlign: 'left' }}>{t('accountColumnDescription')}</Text>
            <Text className="w-12 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnQuantity')}</Text>
            <Text className="flex-1 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnUnitPrice')}</Text>
            <Text className="flex-1 text-center text-[11px] font-bold" style={{ color: colors.ink }}>{t('accountColumnTotalPrice')}</Text>
            <View className="w-8" />
          </View>
          {items.map((item, index) => {
            const member = participantById.get(item.participantId);
            // Only a PRICED modifier row ever carries `removable`, and only
            // while its parent order_item is still genuinely editable — same
            // in_progress + 5-minute-window rule as OrderTracker's own
            // "בצעו שינויים במנה" (2026-10-11, user request: distinguishes a
            // paid add-on, which can be individually removed, from a free
            // choice like doneness, which was never shown as its own row at
            // all and has nothing billable to remove).
            const elapsedMinutes = item.removable ? (Date.now() - new Date(item.removable.placedAt).getTime()) / 60000 : 0;
            const canRemove = !!item.removable && item.removable.status === 'in_progress' && elapsedMinutes <= EDIT_WINDOW_MINUTES;
            return (
              <View
                key={item.id}
                className="flex-row items-center px-4 py-2.5"
                style={{ borderColor: colors.border, borderBottomWidth: index < items.length - 1 ? 1 : 0 }}
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
                <Text className="flex-[2] text-sm text-[#1B2430]">{item.dishName}</Text>
                <Text className="w-12 text-center text-sm text-[#1B2430]">{item.quantity}</Text>
                <Text className="flex-1 text-center text-sm text-[#1B2430]" numberOfLines={1} adjustsFontSizeToFit>
                  ₪{formatPrice(item.unitPrice)}
                </Text>
                <Text className="flex-1 text-center text-sm text-[#1B2430]" numberOfLines={1} adjustsFontSizeToFit>
                  ₪{formatPrice(item.unitPrice * item.quantity)}
                </Text>
                <View className="w-8 items-center">
                  {canRemove && (
                    <Pressable onPress={() => setRemoveTarget(item)} hitSlop={8} accessibilityLabel={t('accountRemoveModifierAction')}>
                      <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </>
      )}

      <ConfirmModal
        visible={removeTarget !== null}
        title={t('accountRemoveModifierConfirmTitle')}
        message={t('accountRemoveModifierConfirmMessage').replace('{name}', removeTarget?.dishName ?? '')}
        cancelLabel={t('back')}
        confirmLabel={t('accountRemoveModifierAction')}
        danger
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void handleRemoveModifier()}
      />

      <ErrorModal visible={removeError !== null} title={t('placeOrderFailedTitle')} message={removeError ?? ''} dismissLabel={t('gotIt')} onDismiss={() => setRemoveError(null)} />
    </View>
  );
}

function StripCell({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View className="flex-1 items-center py-3">
      <Text className="text-[11px] text-[#9CA3AF]" numberOfLines={1} adjustsFontSizeToFit style={{ textAlign: 'center' }}>
        {label}
      </Text>
      <View className="mt-1 flex-row items-center gap-1">
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
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [subTab, setSubTab] = useState<AccountSubTab>('general');
  const [infoOpen, setInfoOpen] = useState(false);
  const [billComingSoonOpen, setBillComingSoonOpen] = useState(false);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);
  const isBarTable = useTableSessionStore((s) => s.tableType === 'bar');
  const sessionAccountNumber = useTableSessionStore((s) => s.sessionAccountNumber);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  const reviewVerificationCode = useTableSessionStore((s) => s.reviewVerificationCode);
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);

  // Lifted here (2026-10-10) rather than fetched separately inside
  // AccountItemsTable — the bottom panel now needs the same total the table
  // shows, so both read from one fetch instead of two independent
  // subscriptions to the same session's data.
  const { items } = useAccountItems(sessionId);
  const { participants } = useSessionParticipants(sessionId);
  const visibleItems = subTab === 'personal' ? items.filter((i) => i.participantId === participantId) : items;
  const total = visibleItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

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

      <View className="flex-row border-b bg-white" style={{ borderColor: colors.border }}>
        {(
          // Order matters under native RTL (I18nManager.forceRTL) — first
          // JSX child renders rightmost. User request 2026-10-10: "חשבון
          // אישי" on the right.
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
              className="flex-1 flex-row items-center justify-center gap-1.5 py-3"
              style={{ borderBottomWidth: active ? 2 : 0, borderColor: colors.royalBlue }}
            >
              <Ionicons name={tab.icon} size={16} color={active ? colors.royalBlue : '#9CA3AF'} />
              <Text className="text-sm font-semibold" style={{ color: active ? colors.royalBlue : '#9CA3AF' }}>
                {t(tab.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pt-4">
          <View className="overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
            <View className="flex-row items-center justify-end px-3 pt-2">
              <Pressable
                onPress={() => setInfoOpen(true)}
                hitSlop={10}
                className="h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: '#38BDF8' }}
              >
                <Ionicons name="information-outline" size={14} color="#FFFFFF" />
              </Pressable>
            </View>
            <View className="flex-row items-stretch px-1 pb-3">
              <StripCell label={t('accountStripTableLabel')} value={tableNumber ?? '—'} />
              <View className="w-px" style={{ backgroundColor: colors.border }} />
              <StripCell label={t('accountStripGeneralLabel')} value={sessionAccountNumber ?? '—'} />
              <View className="w-px" style={{ backgroundColor: colors.border }} />
              <StripCell label={t('accountStripPersonalLabel')} value={subAccountNumber ?? '—'} />
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
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold" style={{ color: colors.success }}>
            ₪{formatAmount(total)}
          </Text>
          {!isBarTable && <CallWaiterInlineTrigger />}
        </View>
        <Text className="mb-1 text-xs leading-4" style={{ color: colors.ink }}>
          {t('serviceFeeDisclaimerPrefix')}
          <Text style={{ fontWeight: '700' }}>{t('serviceFeeDisclaimerEmphasis')}</Text>
        </Text>

        {/* minHeight 48, not py-4 (2026-10-11, user request, follow-up: an
            interim py-3 then py-2 still didn't actually match the cart-
            summary bar's thickness — padding alone can't, since this
            button's text-lg label sits taller than that bar's text-sm one;
            an explicit shared height is what makes them line up) — matches
            CartBarInlineTrigger/placeOrderButton (MenuBrowser.tsx) exactly. */}
        <Pressable
          onPress={() => setBillComingSoonOpen(true)}
          className="items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.royalBlue, minHeight: 48 }}
        >
          <Text className="text-lg font-semibold text-white">{t('requestBillButton')}</Text>
        </Pressable>
      </View>

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-4 text-lg font-bold text-[#1B2430]">{t('accountInfoModalTitle')}</Text>
            {infoRows.map((row, i) => (
              <View key={row.labelKey} className={i > 0 ? 'mt-3.5' : ''}>
                <Text className="text-sm font-semibold text-[#1B2430]">{t(row.labelKey)}</Text>
                <Text className="mt-0.5 text-xs leading-5 text-[#6E6A61]">{t(row.explanationKey)}</Text>
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
