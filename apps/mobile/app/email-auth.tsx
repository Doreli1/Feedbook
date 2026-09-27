import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ErrorModal } from '../src/components/ErrorModal';
import { useI18n } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

type Mode = 'sign-in' | 'sign-up';

// M-03 · יצירת פרופיל חדש (Mobile UI Spec §5), extended to also cover the
// "התחברות באמצעות אימייל" branch of M-02 for an existing account. The spec
// describes that button as auto-routing to a login form vs. this create-
// profile form depending on whether the email already has an account — but
// telling those apart client-side would need a "does this email exist"
// check, which is exactly the user-enumeration risk the Web Admin's own
// password-reset flow deliberately avoids (never confirms whether an email
// is registered). Presenting both as one screen with an explicit toggle
// (same pattern already proven in the Web Admin's SignInUp.tsx) sidesteps
// that without weakening the account-existence privacy guarantee.
//
// Restored to this design on 2026-09-10 by explicit user request — a
// mockup-matching rewrite (white card floating over the hero image) was
// tried and reverted; this plain-background/boxed-input version stays.
export default function EmailAuthScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'sign-up' ? 'sign-up' : 'sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // Validation error only appears after a submit attempt, never mid-typing
  // (Mobile UI Spec §5, M-03 field rule).
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 6;
  const canSubmit = emailValid && passwordValid && !busy;

  async function handleSubmit() {
    setAttempted(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const { error: authError } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });

    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    // On success, useSession's onAuthStateChange fires and app/index.tsx's
    // Splash redirect chain takes the user to /profile — nothing to
    // navigate here ourselves.
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Pure-JS scroll-to-focused-input on both platforms — no native
          module, so it works in plain Expo Go (react-native-keyboard-
          controller was tried first but needs a custom dev client build,
          since it registers real native turbo modules Expo Go doesn't
          bundle). enableOnAndroid is required for Android; iOS behaves this
          way by default. extraScrollHeight keeps the submit button itself
          clear of the keyboard too, not just whichever field is focused. */}
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={80}
        keyboardOpeningTime={0}
      >
        <View className="flex-row items-center px-4 pt-14">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
            hitSlop={12}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name="arrow-forward" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <View className="flex-1 px-6 pt-4">
          <Text className="mb-6 text-2xl font-bold text-[#1B2430]">
            {mode === 'sign-in' ? t('signIn') : t('createProfile')}
          </Text>

          <View className="mb-6 flex-row rounded-xl bg-white p-1" style={{ borderColor: colors.border, borderWidth: 1 }}>
            <Pressable
              onPress={() => setMode('sign-in')}
              className={`flex-1 items-center rounded-lg py-2.5 ${mode === 'sign-in' ? 'bg-[#1B3FA8]' : ''}`}
            >
              <Text className={`font-semibold ${mode === 'sign-in' ? 'text-white' : 'text-[#6E6A61]'}`}>{t('signIn')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('sign-up')}
              className={`flex-1 items-center rounded-lg py-2.5 ${mode === 'sign-up' ? 'bg-[#1B3FA8]' : ''}`}
            >
              <Text className={`font-semibold ${mode === 'sign-up' ? 'text-white' : 'text-[#6E6A61]'}`}>{t('createAccountTab')}</Text>
            </Pressable>
          </View>

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('emailAddress')}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
            className="mb-1 rounded-xl border border-[#E3DED2] bg-white px-4 py-3.5 text-base text-[#1B2430]"
          />
          {attempted && !emailValid && email.length > 0 && (
            <Text className="mb-2 text-xs text-[#DC2626]">{t('emailInvalid')}</Text>
          )}
          <View className="mb-4" />

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('password')}</Text>
          <View className="relative mb-1">
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
              className="rounded-xl border border-[#E3DED2] bg-white py-3.5 pe-12 ps-4 text-base text-[#1B2430]"
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={12}
              className="absolute inset-y-0 end-3 items-center justify-center"
              accessibilityLabel={showPassword ? t('hidePassword') : t('showPassword')}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          {attempted && !passwordValid && (
            <Text className="mb-2 text-xs text-[#DC2626]">{t('passwordTooShort')}</Text>
          )}
          <View className="mb-6" />

          {/* Gray-until-valid affordance, per Mobile UI Spec §5 M-03 rule. */}
          <Pressable
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            className="items-center rounded-xl py-4"
            style={{ backgroundColor: canSubmit ? colors.royalBlue : '#C7C2B4' }}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? t('busyEllipsis') : mode === 'sign-in' ? t('signIn') : t('createProfile')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <ErrorModal
        visible={error !== null}
        title={mode === 'sign-in' ? t('signInFailedTitle') : t('createProfileFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}
