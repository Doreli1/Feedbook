import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BurgerSideMenuPanel } from './BurgerSideMenu';
import { CallWaiterButton } from './CallWaiterButton';
import { MenuBrowser } from './menu/MenuBrowser';
import { OrderTracker } from './orders/OrderTracker';
import { OrderingHeader } from './OrderingHeader';
import { OrderingTabBar, type OrderingTabKey } from './OrderingTabBar';
import { useI18n } from '../lib/i18n';
import { useTableSessionStore } from '../lib/tableSessionStore';
import { colors } from '../theme';

// The single mounted screen for all three (ordering) tabs — see
// OrderingTabBar.tsx's own comment for why this replaced three separate
// routes (user request 2026-09-14: a genuinely seamless tab switch, which a
// route-per-tab architecture could never fully deliver, since it always
// unmounts/remounts the whole screen including the header and tab bar on
// every tap). This is the only screen (ordering)/menu.tsx renders; there is
// no route for /orders or /account anymore.
//
// Absorbs what used to be the separate OrderingChrome.tsx: measuring the
// header+tab-strip's real height for BurgerSideMenuPanel, and the
// required-session-data guard (found on a real device 2026-09-14 — see that
// file's former comment, preserved below). Both only ever had one caller,
// so the extra indirection no longer earned its keep once there was only
// one screen.
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

function AccountTabBody() {
  const { t } = useI18n();
  const [infoOpen, setInfoOpen] = useState(false);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);
  const sessionAccountNumber = useTableSessionStore((s) => s.sessionAccountNumber);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  const reviewVerificationCode = useTableSessionStore((s) => s.reviewVerificationCode);

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
    <View className="flex-1 px-4 pt-5">
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

      <Text className="mt-6 text-center text-sm leading-6 text-[#6E6A61]">{t('accountComingSoon')}</Text>

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
            <Pressable
              onPress={() => setInfoOpen(false)}
              className="mt-5 items-center rounded-lg py-3"
              style={{ backgroundColor: colors.royalBlue }}
            >
              <Text className="font-semibold text-white">{t('closeModal')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function OrderingScreen() {
  const router = useRouter();
  const wrapperRef = useRef<View>(null);
  const [chromeBottom, setChromeBottom] = useState(0);
  const [activeTab, setActiveTab] = useState<OrderingTabKey>('menu');
  // Set when the bell's notification dropdown is tapped — passed to
  // OrderTracker so it can highlight the specific item, requested
  // 2026-09-19 right after the notification feature itself.
  const [orderFocus, setOrderFocus] = useState<{ orderId: string | null; orderItemId: string | null } | null>(null);
  const bodyOpacity = useRef(new Animated.Value(1)).current;
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const hasHydrated = useTableSessionStore((s) => s.hasHydrated);
  // sessionId/participantId/restaurantId were added 2026-09-14 (Stage 5) —
  // a session persisted by an app install from before that still has
  // subAccountNumber but none of these three, since they were never part of
  // setTableSession()'s payload back then. Real bug found on a real device:
  // that old-shape session passed the subAccountNumber-only check below and
  // landed on the menu tab, but MenuBrowser/OrderTracker need restaurantId/
  // sessionId to query anything — with no guard on them, the screen just
  // sat on an empty state/spinner forever with no way out except reinstalling.
  // Same recovery as the missing-subAccountNumber case: send them back to
  // /profile so a fresh scan-qr → join-session repopulates the whole store.
  const hasCompleteSession = !!subAccountNumber && !!sessionId && !!participantId && !!restaurantId;

  useEffect(() => {
    if (hasHydrated && !hasCompleteSession) {
      router.replace('/profile');
    }
  }, [hasHydrated, hasCompleteSession, router]);

  function selectTab(tab: OrderingTabKey) {
    if (tab === activeTab) return;
    // A quick crossfade on the body only — the header and tab bar above
    // never re-render at all, which is what actually makes this feel
    // instant rather than just "smoother."
    bodyOpacity.setValue(0);
    setActiveTab(tab);
    Animated.timing(bodyOpacity, { toValue: 1, duration: 140, useNativeDriver: true }).start();
  }

  if (!hasHydrated || !hasCompleteSession) {
    return null;
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View
        ref={wrapperRef}
        onLayout={() => {
          wrapperRef.current?.measureInWindow((_x, y, _width, height) => {
            setChromeBottom(y + height);
          });
        }}
      >
        <OrderingHeader
          onNavigateToOrder={(target) => {
            selectTab('orders');
            setOrderFocus(target);
          }}
        />
        <OrderingTabBar activeTab={activeTab} onSelect={selectTab} />
      </View>

      <Animated.View style={{ flex: 1, opacity: bodyOpacity }}>
        {activeTab === 'menu' && <MenuBrowser onOrderPlaced={() => selectTab('orders')} />}
        {activeTab === 'orders' && <OrderTracker focusRequest={orderFocus} onFocusHandled={() => setOrderFocus(null)} />}
        {activeTab === 'account' && <AccountTabBody />}
      </Animated.View>

      <BurgerSideMenuPanel topOffset={chromeBottom} />
      <CallWaiterButton />
    </View>
  );
}
