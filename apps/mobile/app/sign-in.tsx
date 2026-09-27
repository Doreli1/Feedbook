import { useState } from 'react';
import { ImageBackground, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { ErrorModal } from '../src/components/ErrorModal';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

// Trying a restaurant-photo hero behind the wordmark (blurred + darkened so
// the logo stays the clear focal point) instead of the plain brand-blue
// field. Flip back to false to instantly revert to the original M-02 look —
// nothing else on this screen changes either way.
const SHOW_HERO_IMAGE = true;
const heroImage = require('../assets/sign-in-hero.jpg');

// M-02 · סוגי התחברות (Mobile UI Spec §5).
export default function SignInScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [oauthBusy, setOauthBusy] = useState<'google' | 'facebook' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOAuth(provider: 'google' | 'facebook') {
    setOauthBusy(provider);
    const redirectTo = 'feedbook://sign-in';
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (oauthError || !data.url) {
      setOauthBusy(null);
      setError(oauthError?.message ?? t('oauthGenericError'));
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    setOauthBusy(null);
    if (result.type === 'success' && result.url) {
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(result.url);
      if (sessionError) setError(sessionError.message);
      // On success, useSession's onAuthStateChange picks up the new session
      // and the Splash redirect chain (app/index.tsx) takes it from there.
    }
  }

  const content = (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <View className="flex-1 items-center justify-center px-8 pt-20">
        <FeedbookWordmark size={40} />
      </View>

      <View className="gap-3 px-6 pb-16">
        <Pressable
          onPress={() => void handleOAuth('google')}
          disabled={oauthBusy !== null}
          className="flex-row items-center justify-center gap-3 rounded-xl bg-white py-3.5 disabled:opacity-60"
        >
          <Ionicons name="logo-google" size={20} color="#1B2430" />
          <Text className="text-base font-semibold text-[#1B2430]">
            {oauthBusy === 'google' ? t('connectingEllipsis') : t('continueWithGoogle')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void handleOAuth('facebook')}
          disabled={oauthBusy !== null}
          className="flex-row items-center justify-center gap-3 rounded-xl bg-[#1877F2] py-3.5 disabled:opacity-60"
        >
          <Ionicons name="logo-facebook" size={20} color="#FFFFFF" />
          <Text className="text-base font-semibold text-white">
            {oauthBusy === 'facebook' ? t('connectingEllipsis') : t('continueWithFacebook')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push({ pathname: '/email-auth', params: { mode: 'sign-in' } })}
          className="flex-row items-center justify-center gap-3 rounded-xl bg-[#122B7A] py-3.5"
        >
          <Ionicons name="mail-outline" size={20} color="#FFFFFF" />
          <Text className="text-base font-semibold text-white">{t('continueWithEmail')}</Text>
        </Pressable>

        <View className="my-2 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-white/25" />
          <Text className="text-xs text-white/70">{t('or')}</Text>
          <View className="h-px flex-1 bg-white/25" />
        </View>

        <Pressable
          onPress={() => router.push({ pathname: '/email-auth', params: { mode: 'sign-up' } })}
          className="flex-row items-center justify-center gap-3 rounded-xl border border-white/40 py-3.5"
        >
          <Ionicons name="person-add-outline" size={20} color="#FFFFFF" />
          <Text className="text-base font-semibold text-white">{t('createYourAccount')}</Text>
        </Pressable>

        <Text className="mt-4 text-center text-xs leading-5 text-white/60">{t('termsAgreement')}</Text>
      </View>
    </ScrollView>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.royalBlue }}>
      {SHOW_HERO_IMAGE ? (
        // blurRadius is a plain built-in Image/ImageBackground prop (no
        // extra native dependency) — a dark overlay sits above it so the
        // wordmark and buttons stay the clear focal point over any photo.
        <ImageBackground source={heroImage} resizeMode="cover" blurRadius={0.8} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(10, 15, 30, 0.5)' }}>{content}</View>
        </ImageBackground>
      ) : (
        content
      )}

      <ErrorModal
        visible={error !== null}
        title={t('signInIncompleteTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}
