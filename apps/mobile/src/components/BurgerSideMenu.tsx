import { useEffect, useState } from 'react';
import { Animated, Dimensions, Easing, I18nManager, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { HeaderBackButton } from './AppHeader';
import { useI18n, visualRowDirection, physicalReadingStart, visualColumnAlign } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { useBurgerMenuStore } from '../lib/burgerMenuStore';
import { useTableSessionStore } from '../lib/tableSessionStore';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

interface Row {
  key: string;
  labelKey: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
}

// Mirrors profile.tsx's own "show the future map, keep it inert" locked-row
// convention, extended to the fuller list from the Stage 5 mockup
// (`8 - BurgerDetails.JPG`) — same data (name/email/Feedstars level), reached
// here as a slide-out panel instead of a full screen, from the menu/order
// section's hamburger icon (2026-09-13).
const MAIN_ROWS: Row[] = [
  { key: 'past-orders', labelKey: 'pastOrders', icon: 'receipt-outline' },
  { key: 'reviews', labelKey: 'myReviews', icon: 'star-outline' },
  { key: 'recently-viewed', labelKey: 'recentlyViewed', icon: 'eye-outline' },
  { key: 'lists', labelKey: 'myLists', icon: 'heart-outline' },
  { key: 'coupon-code', labelKey: 'myCouponCode', icon: 'pricetag-outline' },
  { key: 'gift-cards', labelKey: 'giftCards', icon: 'card-outline' },
];

const SETTINGS_ROWS: Row[] = [
  { key: 'help', labelKey: 'helpAndSupport', icon: 'help-buoy-outline' },
  { key: 'share', labelKey: 'shareApp', icon: 'share-social-outline' },
  { key: 'feedback', labelKey: 'leaveAppFeedback', icon: 'chatbox-ellipses-outline' },
];

// Full window width is always ≥ the panel's own w-[82%] (capped max-w-sm),
// so translating by this much is guaranteed to push it fully off-screen,
// without needing an onLayout measurement of the actual panel width first.
const SCREEN_WIDTH = Dimensions.get('window').width;

// Lives inside OrderingHeader's own row — just the trigger. The actual panel
// is rendered separately (BurgerSideMenuPanel, below), at each screen's top
// level via OrderingChrome, so it can start below the real header+tab-strip
// height instead of covering them (user request 2026-09-14, matching the
// Stage 5 mockup where the header and תפריטים/הזמנות/ניהול חשבון strip stay
// visible above the open menu). Shared open/close state via burgerMenuStore.
//
// While the panel is open, this swaps to the same direction-aware back
// arrow used everywhere else (HeaderBackButton) instead of the hamburger
// glyph — tapping it closes the panel, same as a real back action (user
// request 2026-09-14).
export function BurgerMenuButton() {
  const open = useBurgerMenuStore((s) => s.open);
  const setOpen = useBurgerMenuStore((s) => s.setOpen);
  if (open) {
    return <HeaderBackButton onPress={() => setOpen(false)} />;
  }
  return (
    <Pressable onPress={() => setOpen(true)} hitSlop={10}>
      <Ionicons name="menu-outline" size={26} color="#FFFFFF" />
    </Pressable>
  );
}

export function BurgerSideMenuPanel({ topOffset }: { topOffset: number }) {
  const { t, isRTL } = useI18n();
  // Real bug (2026-10-27): the panel used to always anchor via `left: 0`,
  // relying on I18nManager mirroring that into the physical right edge
  // under Hebrew — confirmed on a real device that this native flag can
  // get stuck not reflecting Hebrew even after forceRTL + a full app
  // relaunch, which left the panel opening from the physical left instead.
  // This explicitly picks the side that lands the panel on the physical
  // right for Hebrew (and physical left for English) regardless of
  // whatever I18nManager.isRTL actually is right now, by counteracting it
  // rather than assuming it will mirror correctly.
  const anchorLeft = isRTL === I18nManager.isRTL;
  const router = useRouter();
  const open = useBurgerMenuStore((s) => s.open);
  const setOpen = useBurgerMenuStore((s) => s.setOpen);
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const clearTableSession = useTableSessionStore((s) => s.clearTableSession);
  const [modalVisible, setModalVisible] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [translateX] = useState(() => new Animated.Value(SCREEN_WIDTH));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  // Slide-in from whichever edge the panel is anchored to (physical right
  // for Hebrew, physical left for English — see anchorLeft above) and back
  // out the same edge on close. transform values are never RTL-mirrored by
  // I18nManager, so "off-screen" is a plain positive translateX (push
  // toward the physical right) when anchored right, or negative (push
  // toward the physical left) when anchored left.
  const hiddenTranslateX = anchorLeft ? -SCREEN_WIDTH : SCREEN_WIDTH;
  useEffect(() => {
    if (open) {
      // setState is tied to kicking off the imperative Animated sequence
      // below, not to a value derivable during render — a legitimate
      // escape hatch, not the "could compute this while rendering" case
      // the rule targets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModalVisible(true);
      translateX.setValue(hiddenTranslateX);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else if (modalVisible) {
      Animated.parallel([
        Animated.timing(translateX, { toValue: hiddenTranslateX, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(() => setModalVisible(false));
    }
    // modalVisible deliberately excluded — only `open` should trigger a
    // fresh animation; the exit branch already reads modalVisible's current
    // value without needing to react to its own updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const current = sessionData.session;
      if (cancelled || !current) return;
      setEmail(current.user.email ?? null);
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('display_name')
        .eq('user_id', current.user.id)
        .maybeSingle();
      if (!cancelled) setDisplayName(profile?.display_name ?? current.user.email?.split('@')[0] ?? null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const initial = (displayName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
        {/* Backdrop and panel both start at topOffset, not 0 — the header
            and תפריטים/הזמנות/ניהול חשבון strip above stay fully visible and
            undimmed, matching the mockup. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: topOffset,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#000000',
            opacity: Animated.multiply(backdropOpacity, 0.4),
          }}
        />
        <Animated.View
          className="absolute bottom-0 w-[82%] max-w-sm"
          style={{
            top: topOffset,
            ...(anchorLeft ? { left: 0 } : { right: 0 }),
            backgroundColor: colors.background,
            transform: [{ translateX }],
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={(e) => e.stopPropagation()}>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <View className="items-center gap-4 px-5 py-5" style={{ flexDirection: visualRowDirection(isRTL) }}>
                <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: colors.royalBlue }}>
                  <Text className="text-xl font-bold text-white">{initial}</Text>
                </View>
                {/* Real bug (2026-10-28): flex-1/stretched Text with no
                    explicit textAlign — same issue found across
                    MenuBrowser.tsx's own titles (see i18n.tsx's
                    physicalReadingStart comment); 'auto' resolves through
                    the stuck I18nManager.isRTL flag, not the actual
                    language. */}
                <View className="flex-1">
                  <Text className="text-lg font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                    {displayName ?? t('loadingEllipsis')}
                  </Text>
                  <Text className="text-xs text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                    {email}
                  </Text>
                  {/* Real bug (2026-10-28): `self-start` is alignSelf on a
                      column's (horizontal) cross axis — same
                      direction-aware-through-the-stuck-flag issue as
                      PriceRow's own alignSelf fix in MenuBrowser.tsx (see
                      i18n.tsx's visualColumnAlign comment), not a fixed
                      physical side. */}
                  <View
                    className="mt-1.5 items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 py-1"
                    style={{ flexDirection: visualRowDirection(isRTL), alignSelf: visualColumnAlign(physicalReadingStart(isRTL)) }}
                  >
                    <Ionicons name="sparkles-outline" size={13} color="#B45309" />
                    <Text className="text-xs font-semibold text-[#B45309]">{t('feedstarsLevel')}</Text>
                  </View>
                </View>
              </View>

              <View className="mx-4 overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
                {MAIN_ROWS.map((row, i) => (
                  <View
                    key={row.key}
                    className={`items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t' : ''}`}
                    style={{ flexDirection: visualRowDirection(isRTL), borderColor: colors.border }}
                  >
                    <Ionicons name={row.icon} size={20} color={colors.textMuted} />
                    <Text className="flex-1 text-sm text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                      {t(row.labelKey)}
                    </Text>
                    <Ionicons name="lock-closed-outline" size={16} color="#C7C2B4" />
                  </View>
                ))}
              </View>

              <Text className="mb-2 mt-5 px-5 text-xs font-semibold text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                {t('settingsSectionTitle')}
              </Text>
              <View className="mx-4 overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
                {SETTINGS_ROWS.map((row, i) => (
                  <View
                    key={row.key}
                    className={`items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t' : ''}`}
                    style={{ flexDirection: visualRowDirection(isRTL), borderColor: colors.border }}
                  >
                    <Ionicons name={row.icon} size={20} color={colors.textMuted} />
                    <Text className="flex-1 text-sm text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                      {t(row.labelKey)}
                    </Text>
                    <Ionicons name="lock-closed-outline" size={16} color="#C7C2B4" />
                  </View>
                ))}
              </View>

              {/* Test-only utility (2026-10-19, user request — this is the
                  real "hamburger" menu, unlike AppHeader.tsx's "⋮" dropdown
                  which an earlier attempt wrongly added this to) — clears
                  the local session without closing anything server-side, so
                  "diner walked away without paying" can be simulated to
                  exercise the mail-icon open-visit reminder, instead of
                  reaching into the DB to fake it. Not a real diner-facing
                  feature, functional unlike the locked rows above; remove
                  when no longer needed. */}
              {!!restaurantId && (
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    clearTableSession();
                    router.replace('/profile');
                  }}
                  className="mx-4 mt-5 items-center gap-3 overflow-hidden rounded-xl bg-white px-4 py-3.5"
                  style={{ flexDirection: visualRowDirection(isRTL), borderColor: colors.danger, borderWidth: 1 }}
                >
                  <Ionicons name="construct-outline" size={20} color={colors.danger} />
                  <Text className="flex-1 text-sm font-medium" style={{ color: colors.danger, textAlign: physicalReadingStart(isRTL) }}>
                    {t('testDisconnectSessionMenuItem')}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
