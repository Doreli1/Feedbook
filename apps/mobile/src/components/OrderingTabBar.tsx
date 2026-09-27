import { Pressable, Text, View } from 'react-native';
import { useI18n } from '../lib/i18n';
import { colors } from '../theme';

// The persistent 3-tab strip confirmed in the Stage 5 mockups (7.1, 7.2, 9 —
// "תפריטים / הזמנות / ניהול חשבון"), shown directly under the AppHeader.
//
// Rebuilt 2026-09-14 (user request: a genuinely seamless switch, no jump at
// all): this used to drive three separate expo-router routes via
// router.replace(), which — even with a crossfade animation — still fully
// unmounted and remounted the entire screen (header, tab bar, everything)
// on every tap, since each tab was its own route. Now purely internal React
// state (see OrderingScreen.tsx, the single mounted screen for all three
// tabs) — the header and this bar never unmount at all when switching, only
// the body content underneath swaps, which is what actually makes the
// switch feel instant and jump-free instead of just "less jumpy."
export type OrderingTabKey = 'menu' | 'orders' | 'account';

const TABS: { key: OrderingTabKey; labelKey: 'menuTabLabel' | 'ordersTabLabel' | 'accountTabLabel' }[] = [
  { key: 'menu', labelKey: 'menuTabLabel' },
  { key: 'orders', labelKey: 'ordersTabLabel' },
  { key: 'account', labelKey: 'accountTabLabel' },
];

export function OrderingTabBar({ activeTab, onSelect }: { activeTab: OrderingTabKey; onSelect: (tab: OrderingTabKey) => void }) {
  const { t } = useI18n();

  // Amber marks the active tab — both label and underline (matching the
  // mockups' gold highlight — not one of theme.ts's named tokens, so a
  // literal hex here, same as other one-off colors already inlined
  // throughout this app). Inactive tabs stay plain white, matching the
  // header icons' color (user request 2026-09-13).
  const activeAmber = '#F5A623';

  return (
    // Same blue as AppHeader itself (colors.royalBlue, not the darker
    // royalBlueDark) so the header and tab strip read as one uniform bar —
    // user request 2026-09-13.
    <View className="flex-row" style={{ backgroundColor: colors.royalBlue }}>
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            className="flex-1 items-center py-3.5"
            style={{ borderBottomWidth: 3, borderColor: active ? activeAmber : 'transparent' }}
          >
            <Text className="text-base font-bold" style={{ color: active ? activeAmber : '#FFFFFF' }}>
              {t(tab.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
