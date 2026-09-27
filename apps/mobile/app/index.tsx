import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../src/lib/useSession';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n } from '../src/lib/i18n';
import { useTableSessionStore } from '../src/lib/tableSessionStore';

// M-01 · מסך טעינה (Splash) — Mobile UI Spec §5. The user has no choice here;
// the animated spinner + Hebrew caption exist purely as feedback (Nielsen
// principle 2) so the app never reads as "stuck" while the session resolves.
//
// Fixed 2026-09-14 (real bug, found on a real device): this used to always
// redirect a signed-in user to /profile, unconditionally — including right
// after the language-switch reload (setLang in lib/i18n.tsx calls
// DevSettings.reload() to make I18nManager.forceRTL take effect, a real JS
// VM restart, not a backgrounding). Every reload restarts here at Splash,
// so a diner mid-visit, sitting on the ordering tabs, got dropped back to
// /profile every single time they changed language — losing their place
// even though their table session was still genuinely active (and, since
// 2026-09-14, actually still persisted — see tableSessionStore.ts). Now
// checks for that persisted session too and resumes straight into /menu
// when one exists, instead of always landing on /profile.
export default function SplashScreen() {
  const { status } = useSession();
  const { t } = useI18n();
  const hasHydrated = useTableSessionStore((s) => s.hasHydrated);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);

  if (status === 'signed-out') return <Redirect href="/sign-in" />;
  if (status === 'signed-in' && hasHydrated) {
    return <Redirect href={subAccountNumber ? '/menu' : '/profile'} />;
  }

  return (
    <View className="flex-1 bg-[#1B3FA8]">
      <View className="flex-1 items-center justify-center">
        <FeedbookWordmark size={32} />
      </View>
      <View className="items-center pb-24">
        <ActivityIndicator color="#FFFFFF" size="small" />
        <Text className="mt-3 text-sm text-white">{t('splashTagline')}</Text>
      </View>
    </View>
  );
}
