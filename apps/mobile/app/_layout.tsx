import '../global.css';
import { useEffect } from 'react';
import { DevSettings, I18nManager, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import { getPersistedLang, I18nProvider } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

// Mobile UI Spec §2, rule "שפה שירותית": Hebrew/RTL is the default, but the
// diner can switch to English from the header's `⋮` menu (src/lib/i18n.tsx)
// — direction then has to follow the chosen language, not just default to
// RTL always. I18nManager only takes visual effect after a reload (a native
// RN constraint, not fixable in JS), so this reads the persisted choice
// once at boot and self-corrects with a single automatic reload if the
// native flag doesn't match it yet.
//
// This used to be a synchronous top-level `if (!I18nManager.isRTL) {
// forceRTL(true); reload() }` that *always* pushed toward RTL — real bug
// hit in practice: after a Metro `--clear` restart the flag can regress to
// LTR (every flex-row header rendered mirrored) until a manual reload, and
// that same unconditional "always RTL" logic would fight a saved English
// preference and reload forever. Centralizing the target state in one
// async, storage-aware check avoids both.
function useRTLSync() {
  useEffect(() => {
    let cancelled = false;
    void getPersistedLang().then((lang) => {
      const shouldBeRTL = lang === 'he';
      if (!cancelled && I18nManager.isRTL !== shouldBeRTL) {
        I18nManager.allowRTL(true);
        I18nManager.forceRTL(shouldBeRTL);
        // DevSettings is a no-op outside of development — this self-heal
        // has no effect in a real production build (not relevant yet,
        // there is no production build of this app).
        DevSettings.reload();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
}

// Tried swapping to @react-navigation/stack (via expo-router's own
// withLayoutContext escape hatch) to get real cross-platform transition-
// duration control — blocked hard at the framework level: "As of SDK 56,
// expo-router is no longer compatible with react-navigation" (confirmed
// against the real dev server, not the docs). expo-router now ships its own
// forked navigation stack (see node_modules/expo-router/build/fork/), not a
// thin wrapper over @react-navigation/native-stack anymore, so any real
// react-navigation package is a hard conflict, not just a version mismatch.
// Reverted to the built-in <Stack> — animationDuration below is confirmed
// iOS-only (react-navigation's own native-stack type docs, and directly on
// this device: 150/100/50ms all rendered identically on Android). No
// JS-exposed knob exists for Android's transition speed on this Expo SDK.
export default function RootLayout() {
  const router = useRouter();
  useRTLSync();
  // Same "Baloo 2" bold wordmark font as the Web Admin's .font-brand
  // (apps/web/src/index.css) — the one visual element required to match
  // exactly across both apps, per the diner-app owner's own request.
  const [fontsLoaded] = useFonts({ Baloo2_700Bold });

  // M-01's own useSession() lives inside app/index.tsx (Splash) and only
  // ever runs the FIRST redirect decision — once Splash's own <Redirect>
  // fires, Splash unmounts (a route "replace", not a stack push) and takes
  // its onAuthStateChange subscription with it. A sign-up/sign-in completed
  // later from a different screen (e.g. email-auth) then had no listener
  // left anywhere to react to it — the request succeeds for real (confirmed
  // against real GoTrue logs: 200, immediate_login_after_signup), but the
  // UI never navigates, so it looks like nothing happened. This listener
  // lives at the root, for the app's entire lifetime, specifically to catch
  // that transition from any screen — not a duplicate of Splash's own
  // one-time initial-load decision.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') router.replace('/profile');
      if (event === 'SIGNED_OUT') router.replace('/sign-in');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (!fontsLoaded) {
    // Matches Splash's own background so there's no flash of a different
    // color before the wordmark font is ready to render it.
    return <View style={{ flex: 1, backgroundColor: colors.royalBlue }} />;
  }

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_bottom', animationDuration: 50 }} />
      </I18nProvider>
    </SafeAreaProvider>
  );
}
