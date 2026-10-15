import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ErrorModal } from '../src/components/ErrorModal';
import { useI18n } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

// Second half of the forgot-password flow started in forgot-password.tsx —
// see that file's comment for why this is a typed-code screen rather than
// an emailed link. verifyOtp({ type: 'recovery' }) fires a PASSWORD_RECOVERY
// auth event (not SIGNED_IN), so the root layout's global
// onAuthStateChange listener (app/_layout.tsx) doesn't redirect away before
// the password is actually set; updateUser() afterwards fires USER_UPDATED,
// equally ignored by that listener, so this screen navigates on manually
// once both calls succeed.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const codeValid = /^\d{6}$/.test(code.trim());
  const passwordValid = password.length >= 6;
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = codeValid && passwordValid && passwordsMatch && !busy && !!email;

  async function handleSubmit() {
    setAttempted(true);
    if (!canSubmit || !email) return;
    setBusy(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'recovery',
    });
    if (verifyError) {
      setBusy(false);
      setError(verifyError.message);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/profile');
  }

  async function handleResend() {
    if (!email || resending) return;
    setResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resetPasswordForEmail(email);
    setResending(false);
    if (resendError) setError(resendError.message);
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
        <View className="flex-row items-center px-4 pt-14">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/email-auth'))}
            hitSlop={12}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name="arrow-forward" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <View className="flex-1 px-6 pt-4">
          <Text className="mb-1 text-2xl font-bold text-[#1B2430]">{t('enterResetCodeTitle')}</Text>
          <Text className="mb-6 text-sm text-[#6E6A61]">
            {email ? t('resetCodeSentMessage') : t('enterResetCodeSubtitle')}
          </Text>

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('resetCode')}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            className="mb-1 rounded-xl border border-[#E3DED2] bg-white px-4 py-3.5 text-base text-[#1B2430]"
            style={{ letterSpacing: 4, textAlign: 'center' }}
          />
          {attempted && !codeValid && code.length > 0 && (
            <Text className="mb-2 text-xs text-[#DC2626]">{t('resetCodeInvalid')}</Text>
          )}
          <View className="mb-4" />

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('newPassword')}</Text>
          <View className="relative mb-1">
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              textContentType="newPassword"
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
          <View className="mb-4" />

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('confirmNewPassword')}</Text>
          <View className="relative mb-1">
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              textContentType="newPassword"
              className="rounded-xl border border-[#E3DED2] bg-white py-3.5 pe-12 ps-4 text-base text-[#1B2430]"
            />
            <Pressable
              onPress={() => setShowConfirm((v) => !v)}
              hitSlop={12}
              className="absolute inset-y-0 end-3 items-center justify-center"
              accessibilityLabel={showConfirm ? t('hidePassword') : t('showPassword')}
            >
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          {attempted && confirm.length > 0 && !passwordsMatch && (
            <Text className="mb-2 text-xs text-[#DC2626]">{t('passwordsDontMatch')}</Text>
          )}
          <View className="mb-6" />

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            className="mb-4 items-center rounded-xl py-4"
            style={{ backgroundColor: canSubmit ? colors.royalBlue : '#C7C2B4' }}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? t('busyEllipsis') : t('updatePassword')}
            </Text>
          </Pressable>

          <Pressable onPress={() => void handleResend()} disabled={resending} hitSlop={8} className="items-center py-2">
            <Text className="text-sm text-[#1B3FA8]">{resending ? t('sendingEllipsis') : t('didntGetCode')}</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <ErrorModal
        visible={error !== null}
        title={t('resetPasswordFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}
