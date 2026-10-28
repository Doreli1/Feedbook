import '../global.css';
import { useEffect, useState } from 'react';
import { DevSettings, I18nManager, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
// Persists a small bounded retry count per RTL target, not a one-shot
// "already tried" flag — AsyncStorage survives DevSettings.reload() itself,
// unlike a plain in-memory flag, which is the point of using it here.
// Versioned key (2026-10-27 follow-up): the one-shot version of this guard
// got written to "true" on a device while the app was crash-looping for an
// entirely unrelated reason (a corrupted Metro/pnpm install, now fixed) —
// once that got fixed and the app finally booted cleanly, the stale
// one-shot guard permanently blocked the one reload still needed to
// actually flip to RTL, leaving the app stuck mirrored in LTR with no way
// to self-heal short of manually clearing app storage. A bounded counter
// instead of a boolean tolerates a few real crashes/interruptions across
// separate launches (each gets to retry) while still giving up for good
// after a few attempts if the native flag genuinely never flips (the
// original New Architecture concern) — and it resets itself to 0 the
// moment isRTL actually matches, so a future regression can self-heal
// again too. The "v2" key sidesteps today's already-stuck "true" value
// under the old key entirely, rather than needing to detect/migrate it.
const RTL_RELOAD_GUARD_KEY = 'feedbook-mobile-rtl-reload-attempt-count-v2';
const RTL_RELOAD_MAX_ATTEMPTS = 3;

function useRTLSync() {
  useEffect(() => {
    let cancelled = false;
    void getPersistedLang().then(async (lang) => {
      const shouldBeRTL = lang === 'he';
      if (cancelled || I18nManager.isRTL === shouldBeRTL) {
        // Already correct — clear any leftover attempt count so a future
        // regression (isRTL somehow flipping back) can self-heal again.
        await AsyncStorage.removeItem(RTL_RELOAD_GUARD_KEY).catch(() => {});
        return;
      }
      const storedKey = `${RTL_RELOAD_GUARD_KEY}:${String(shouldBeRTL)}`;
      const raw = await AsyncStorage.getItem(storedKey).catch(() => null);
      const attempts = raw ? Number(raw) || 0 : 0;
      if (cancelled || attempts >= RTL_RELOAD_MAX_ATTEMPTS) return;
      await AsyncStorage.setItem(storedKey, String(attempts + 1)).catch(() => {
        // Can't persist the guard — safer to skip the reload entirely than
        // risk looping with no way to remember we already tried.
      });
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(shouldBeRTL);
      // DevSettings is a no-op outside of development — this self-heal
      // has no effect in a real production build (not relevant yet,
      // there is no production build of this app).
      DevSettings.reload();
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
  // Real bug (2026-10-28, per explicit report — Splash's "Feedbook" text
  // not visually matching the same FeedbookWordmark component rendered
  // later in any real header, despite being the literal same component/
  // fontFamily string): a known Android-specific expo-font race — useFonts'
  // own `fontsLoaded` flips true as soon as the JS promise resolves, which
  // can land a render BEFORE Android's native text-rendering system has
  // actually finished registering the freshly loaded typeface, so that
  // very first paint (Splash's) silently falls back to the system font
  // while every LATER screen (already past that first paint) renders
  // correctly. Two rAF ticks after fontsLoaded flips true, before this
  // gate gives way to any real screen, gives the native side a couple of
  // bridge round-trips to settle first.
  const [fontsSettled, setFontsSettled] = useState(false);
  useEffect(() => {
    if (!fontsLoaded) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setFontsSettled(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [fontsLoaded]);

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

  if (!fontsSettled) {
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
