import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../src/lib/useSession';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n } from '../src/lib/i18n';
import { useTableSessionStore } from '../src/lib/tableSessionStore';
import { colors } from '../src/theme';

// M-01 · מסך טעינה (Splash) — Mobile UI Spec §5. The user has no choice here;
// the animated spinner + Hebrew caption exist purely as feedback (Nielsen
// principle 2) so the app never reads as "stuck" while the session resolves.
//
// Fixed 2026-09-14 (real bug, found on a real device): this used to always
// redirect a signed-in user to /profile, unconditionally. Now checks for a
// persisted table session too and resumes straight into /menu when one
// exists, instead of always landing on /profile.
//
// setLang (lib/i18n.tsx) no longer reloads the app on a language change
// (2026-10-28 fix) — every layout decision in this app counteracts
// I18nManager.isRTL explicitly instead of depending on it, so a plain state
// update is enough to re-render correctly in the new language. This screen
// no longer needs to resume a diner mid-flow on some other screen after a
// language-triggered reload, since that reload doesn't happen anymore.
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
    // Real bug (2026-10-28, per explicit report — "looks off from the
    // mockup"): this used to hardcode its own `bg-[#1B3FA8]` Tailwind
    // arbitrary-value class, a literal duplicate of colors.royalBlue (the
    // same navy every real header uses) rather than that single source of
    // truth — a correct-by-coincidence duplicate today, but with no
    // guarantee of staying in sync with the header if that color is ever
    // retuned, and not even confirmed to compile identically to a plain
    // inline style under this app's current NativeWind setup. Driven from
    // `colors.royalBlue` directly instead.
    <View className="flex-1" style={{ backgroundColor: colors.royalBlue }}>
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
