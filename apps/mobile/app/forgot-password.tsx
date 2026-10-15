import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ErrorModal } from '../src/components/ErrorModal';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

// Mobile has no clickable-link/deep-link handling built (unlike Web Admin's
// SignInUp.tsx + SetNewPassword.tsx) — a real gap found 2026-10-15 when the
// app's own owner got locked out of their own account with no way back in.
// Rather than build deep-link parsing (fragile to get right blind, needs a
// registered scheme + allow-listed redirect URL in both local and cloud
// auth config), this uses the OTP-code variant of the same `recovery` email
// Supabase already sends: the email now also shows a 6-digit {{ .Token }}
// (supabase/templates/recovery.html) that the user types into /reset-
// password, verified via supabase.auth.verifyOtp({ type: 'recovery' }) —
// same underlying flow as Web Admin, different UI for a platform with no
// real URL bar.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailValid && !busy;

  async function handleSubmit() {
    setAttempted(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const trimmed = email.trim();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed);

    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    router.push({ pathname: '/reset-password', params: { email: trimmed } });
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={80}
        keyboardOpeningTime={0}
      >
        <View className="flex-row items-center gap-2 px-4 pt-14">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/email-auth'))}
            hitSlop={12}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name="arrow-forward" size={22} color={colors.ink} />
          </Pressable>
          <FeedbookWordmark size={20} color={colors.ink} />
        </View>

        <View className="flex-1 px-6 pt-4">
          <Text className="mb-1 text-2xl font-bold text-[#1B2430]">{t('forgotPasswordTitle')}</Text>
          <Text className="mb-6 text-sm text-[#6E6A61]">{t('forgotPasswordSubtitle')}</Text>

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
          <View className="mb-6" />

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            className="items-center rounded-xl py-4"
            style={{ backgroundColor: canSubmit ? colors.royalBlue : '#C7C2B4' }}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? t('sendingEllipsis') : t('sendResetCode')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <ErrorModal
        visible={error !== null}
        title={t('sendResetCodeFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}
