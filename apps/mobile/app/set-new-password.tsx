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

// Third and final screen of the forgot-password flow — only reachable
// after reset-password.tsx's verifyOtp() call already established a
// PASSWORD_RECOVERY session, so updateUser() below needs no email/code of
// its own, just the new password. No deep-link/email param here by design
// (split out from reset-password.tsx 2026-10-15, user request) — the two
// steps are unrelated concerns (proving the code vs. choosing a password)
// and unlike Web Admin's SetNewPassword.tsx there's no MFA/AAL2 complexity
// to handle (diners have no MFA — see useAuth.ts's own comment on that, web
// side only), so this stays a plain form.
export default function SetNewPasswordScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const passwordValid = password.length >= 6;
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = passwordValid && passwordsMatch && !busy;

  async function handleSubmit() {
    setAttempted(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/profile');
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
          <FeedbookWordmark size={30} color={colors.royalBlue} />
        </View>

        <View className="flex-1 px-6 pt-4">
          <Text className="mb-1 text-2xl font-bold text-[#1B2430]">{t('setNewPasswordTitle')}</Text>
          <Text className="mb-6 text-sm text-[#6E6A61]">{t('setNewPasswordSubtitle')}</Text>

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('newPassword')}</Text>
          <View className="relative mb-1">
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              textContentType="newPassword"
              autoFocus
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
            className="items-center rounded-xl py-4"
            style={{ backgroundColor: canSubmit ? colors.royalBlue : '#C7C2B4' }}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? t('busyEllipsis') : t('updatePassword')}
            </Text>
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
