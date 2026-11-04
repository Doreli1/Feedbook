import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n, visualRowDirection, physicalReadingStart } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

export interface AvailabilityNotice {
  messageKey: TranslationKey;
  // Bold + slightly larger text/icon (2026-11-04, user request) — only
  // barClosingNoticeMessage uses this today (the diner is already seated
  // at the bar and it's winding down for the day); kitchenClosedMessage/
  // barNoFoodDishesMessage stay the original plain, smaller treatment.
  emphasize?: boolean;
}

// Bottom-strip notice (2026-11-04, user request) for a live kitchen/bar
// availability change mid-visit — "!" alert-circle in the same #38BDF8 blue
// already established app-wide for this exact kind of attention mark (see
// MenuBrowser.tsx's own addon-group hint), not the red `danger` token: this
// is an expected, normal state (the kitchen/bar is simply closed, or the
// bar's own menu has nothing to offer right now), never a real error — same
// "info, not alarm" distinction ErrorModal's own tone prop already draws.
export function AvailabilityNoticeBanner({ notice }: { notice: AvailabilityNotice }) {
  const { t, isRTL } = useI18n();
  return (
    <View
      className="items-center rounded-xl border px-3 py-2.5"
      style={{ flexDirection: visualRowDirection(isRTL), gap: 8, backgroundColor: '#EAF6FD', borderColor: '#BAE6FD' }}
    >
      <Ionicons name="alert-circle" size={notice.emphasize ? 22 : 18} color="#38BDF8" />
      {/* One line, never wrapped (2026-11-04, user request) — on the
          emphasized notice only (so far just barClosingNoticeMessage):
          adjustsFontSizeToFit shrinks the text to fit that one line on a
          narrow screen instead of truncating it with an ellipsis. */}
      <Text
        numberOfLines={notice.emphasize ? 1 : undefined}
        adjustsFontSizeToFit={notice.emphasize}
        minimumFontScale={0.8}
        className={`flex-1 ${notice.emphasize ? 'text-sm font-bold leading-5' : 'text-xs leading-4'}`}
        style={{ textAlign: physicalReadingStart(isRTL), color: '#1B2430' }}
      >
        {t(notice.messageKey)}
      </Text>
    </View>
  );
}
