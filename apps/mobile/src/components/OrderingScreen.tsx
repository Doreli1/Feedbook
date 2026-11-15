import { useEffect, useRef, useState } from 'react';
import { Animated, View, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AccountScreen } from './account/AccountScreen';
import { AvailabilityNoticeBanner, type AvailabilityNotice } from './AvailabilityNoticeBanner';
import { BurgerSideMenuPanel } from './BurgerSideMenu';
import { CallWaiterInlineTrigger } from './CallWaiterButton';
import { ErrorModal } from './ErrorModal';
import { CartBarInlineTrigger, MenuBrowser } from './menu/MenuBrowser';
import { OrderTracker } from './orders/OrderTracker';
import { OrderingHeader } from './OrderingHeader';
import { OrderingTabBar, type OrderingTabKey } from './OrderingTabBar';
import { useCartStore } from '../lib/cartStore';
import { useI18n, visualRowDirection } from '../lib/i18n';
import { useOrderingAvailability } from '../lib/useOrderingAvailability';
import { supabase } from '../lib/supabase';
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
export function OrderingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRTL, t } = useI18n();
  // RN 0.88 (New Architecture) exposes a dedicated *Instance type per host
  // component for refs — useRef<View> no longer carries measureInWindow().
  const wrapperRef = useRef<ViewInstance>(null);
  const [chromeBottom, setChromeBottom] = useState(0);
  const [activeTab, setActiveTab] = useState<OrderingTabKey>('menu');
  // Set when the bell's notification dropdown is tapped — passed to
  // OrderTracker so it can highlight the specific item, requested
  // 2026-09-19 right after the notification feature itself.
  const [orderFocus, setOrderFocus] = useState<{ orderId: string | null; orderItemId: string | null } | null>(null);
  const [bodyOpacity] = useState(() => new Animated.Value(1));
  // Reported up from MenuBrowser (2026-11-04, user request) — it's the one
  // that knows whether the bar's own curated menu has any food dishes at
  // all, which this screen has no way to compute on its own.
  const [availabilityNotice, setAvailabilityNotice] = useState<AvailabilityNotice | null>(null);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const isBarTable = useTableSessionStore((s) => s.tableType === 'bar');
  const hasHydrated = useTableSessionStore((s) => s.hasHydrated);
  const clearTableSession = useTableSessionStore((s) => s.clearTableSession);
  const cartItemCount = useCartStore((s) => s.items.length);
  const { kitchenOpen, barActive, restaurantActive } = useOrderingAvailability(restaurantId, isBarTable);
  const [sessionClosedModalOpen, setSessionClosedModalOpen] = useState(false);
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

  // Real bug found live (2026-11-09): the bar's general account can close
  // out from under an already-connected diner — the bar's own schedule
  // ending, or staff changing its hours right as the window flips — with
  // zero warning. The session/participant cached in tableSessionStore just
  // goes stale, and every server-validated action (place-order,
  // call-waiter, ...) then fails silently with a generic error, since this
  // screen's own `hasCompleteSession` guard above only checks that the
  // store HAS values, never whether the session they name is still real.
  //
  // Scoped to a diner with nothing outstanding (totalCost === 0, the exact
  // same zero-balance rule useAccounts.ts and confirm-*-payment's own
  // "everyoneElseSettled" check already use) — explicit user decision: a
  // diner who actually ordered something is the "forgotten session" gap
  // already tracked separately (see project_forgotten_session_table_
  // release_gap memory) and deliberately NOT handled here; silently
  // disconnecting someone with money already on the table would make that
  // gap worse, not better, so they're left exactly as before (same stale
  // state, no new behavior) until that fuller spec exists.
  useEffect(() => {
    if (!sessionId || !participantId) return;
    const myParticipantId = participantId;
    let cancelled = false;

    async function checkAndHandleClosedSession() {
      const { data: orderItemRows } = await supabase
        .from('order_items')
        .select('quantity, unit_price, status, orders!inner(participant_id), order_item_modifiers(price_delta_at_order)')
        .eq('orders.participant_id', myParticipantId)
        .neq('status', 'cancelled');
      let totalCost = 0;
      for (const row of orderItemRows ?? []) {
        const modifierTotal = (row.order_item_modifiers ?? []).reduce(
          (sum: number, m: { price_delta_at_order: number }) => sum + Number(m.price_delta_at_order),
          0,
        );
        totalCost += (Number(row.unit_price) + modifierTotal) * row.quantity;
      }
      if (!cancelled && totalCost === 0) {
        setSessionClosedModalOpen(true);
      }
    }

    const channel = supabase
      .channel(`session-closed-guard-${sessionId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          if ((payload.new as { status?: string })?.status !== 'open') void checkAndHandleClosedSession();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, participantId]);

  function handleSessionClosedDismiss() {
    setSessionClosedModalOpen(false);
    clearTableSession();
    router.replace('/profile');
  }

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

  const showCallWaiterRow = activeTab !== 'account' && !isBarTable;
  const showCartBar = activeTab === 'menu' && cartItemCount > 0;
  const showAvailabilityNotice = activeTab === 'menu' && availabilityNotice !== null;

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
        {activeTab === 'menu' && (
          <MenuBrowser
            onOrderPlaced={() => selectTab('orders')}
            kitchenOpen={kitchenOpen}
            barActive={barActive}
            restaurantActive={restaurantActive}
            onAvailabilityNoticeChange={setAvailabilityNotice}
          />
        )}
        {activeTab === 'orders' && <OrderTracker focusRequest={orderFocus} onFocusHandled={() => setOrderFocus(null)} />}
        {activeTab === 'account' && <AccountScreen />}
      </Animated.View>

      <BurgerSideMenuPanel topOffset={chromeBottom} />

      {/* Call-waiter trigger (2026-10-10, user request) — styled and placed
          like AccountScreen's own embedded one (icon+label, no floating
          pill), inside a real (not absolutely-positioned) bottom strip, so
          every tab now gets the same treatment instead of a screen-wide
          floating button. Account tab keeps its own version, built into its
          bottom panel alongside the total/disclaimer/bill button, so it's
          excluded here. Hidden entirely for bar seating (2026-10-11, user
          request): real restaurants treat the bar as the bar staff's own
          responsibility, not the floor waiters', and there is no dedicated
          bar staff role in the system yet for a bar call to even be
          resolvable by the right person — see tableSessionStore.ts's own
          comment on tableType.

          The cart-summary bar (CartBarInlineTrigger) joins this same strip
          below the call-waiter row (2026-10-11, user request) — moved out
          of MenuBrowser's own absolutely-positioned floating pill. Kept on
          the menu tab only (its original scope) and shown independently of
          isBarTable: a bar table still orders food/drinks through the app,
          only the waiter-call escalation is bar staff's job, not the cart's
          own existence.

          AvailabilityNoticeBanner (2026-11-04, user request) joins the same
          strip, last — "at the bottom of the screen, above the device's own
          nav bar" is exactly this strip's own placement (it already sits
          directly above insets.bottom). Menu-tab only, same as the cart bar:
          the dimmed food/drink tabs it explains are only ever visible there. */}
      {(showCallWaiterRow || showCartBar || showAvailabilityNotice) && (
        <View className="px-4 pt-3" style={{ backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }}>
          {showCallWaiterRow && (
            <View className="justify-end" style={{ flexDirection: visualRowDirection(isRTL) }}>
              <CallWaiterInlineTrigger />
            </View>
          )}
          {showCartBar && (
            <View className={showCallWaiterRow ? 'mt-3' : undefined}>
              <CartBarInlineTrigger />
            </View>
          )}
          {showAvailabilityNotice && availabilityNotice && (
            <View className={showCallWaiterRow || showCartBar ? 'mt-3' : undefined}>
              <AvailabilityNoticeBanner notice={availabilityNotice} />
            </View>
          )}
        </View>
      )}

      <ErrorModal
        visible={sessionClosedModalOpen}
        tone="info"
        title={t('sessionClosedTitle')}
        message={t('sessionClosedMessage')}
        dismissLabel={t('gotIt')}
        onDismiss={handleSessionClosedDismiss}
      />
    </View>
  );
}
