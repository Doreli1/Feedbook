import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HeaderBackButton } from './AppHeader';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { useBurgerMenuStore } from '../lib/burgerMenuStore';
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
  const { t } = useI18n();
  const open = useBurgerMenuStore((s) => s.open);
  const setOpen = useBurgerMenuStore((s) => s.setOpen);
  const [modalVisible, setModalVisible] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Slide-in from the right on open, slide back out to the right on close —
  // transform values are never RTL-mirrored by I18nManager (unlike absolute
  // left/right, already confirmed this session to mirror), so a plain
  // positive translateX always means "further toward the physical right"
  // regardless of forceRTL, matching this panel's own `left: 0` anchor to
  // the physical right edge.
  useEffect(() => {
    if (open) {
      setModalVisible(true);
      translateX.setValue(SCREEN_WIDTH);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else if (modalVisible) {
      Animated.parallel([
        Animated.timing(translateX, { toValue: SCREEN_WIDTH, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
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
          // `left: 0` (not `right`) lands this on the physical right edge —
          // confirmed this session that absolute left/right positions get
          // mirrored under I18nManager.forceRTL(true), unlike flex-row order.
          style={{ top: topOffset, left: 0, backgroundColor: colors.background, transform: [{ translateX }] }}
        >
          <Pressable style={{ flex: 1 }} onPress={(e) => e.stopPropagation()}>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <View className="flex-row items-center gap-4 px-5 py-5">
                <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: colors.royalBlue }}>
                  <Text className="text-xl font-bold text-white">{initial}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-[#1B2430]">{displayName ?? t('loadingEllipsis')}</Text>
                  <Text className="text-xs text-[#6E6A61]">{email}</Text>
                  <View className="mt-1.5 flex-row items-center gap-1.5 self-start rounded-full bg-[#FEF3C7] px-2.5 py-1">
                    <Ionicons name="sparkles-outline" size={13} color="#B45309" />
                    <Text className="text-xs font-semibold text-[#B45309]">{t('feedstarsLevel')}</Text>
                  </View>
                </View>
              </View>

              <View className="mx-4 overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
                {MAIN_ROWS.map((row, i) => (
                  <View
                    key={row.key}
                    className={`flex-row items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: colors.border }}
                  >
                    <Ionicons name={row.icon} size={20} color={colors.textMuted} />
                    <Text className="flex-1 text-sm text-[#9CA3AF]">{t(row.labelKey)}</Text>
                    <Ionicons name="lock-closed-outline" size={16} color="#C7C2B4" />
                  </View>
                ))}
              </View>

              <Text className="mb-2 mt-5 px-5 text-xs font-semibold text-[#6E6A61]">{t('settingsSectionTitle')}</Text>
              <View className="mx-4 overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
                {SETTINGS_ROWS.map((row, i) => (
                  <View
                    key={row.key}
                    className={`flex-row items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: colors.border }}
                  >
                    <Ionicons name={row.icon} size={20} color={colors.textMuted} />
                    <Text className="flex-1 text-sm text-[#9CA3AF]">{t(row.labelKey)}</Text>
                    <Ionicons name="lock-closed-outline" size={16} color="#C7C2B4" />
                  </View>
                ))}
              </View>
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
