import { useRef, useState } from 'react';
import { I18nManager, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ErrorModal } from '../src/components/ErrorModal';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

const CODE_LENGTH = 6;

// Second screen of the forgot-password flow started in forgot-password.tsx
// — code entry only. Verifying the code here (not bundling it with the new-
// password form on one screen, per the user's explicit request 2026-10-15)
// establishes the PASSWORD_RECOVERY session; set-new-password.tsx is a
// separate screen reached only after that succeeds. See that file's own
// comment for why neither screen causes the root layout's global
// onAuthStateChange listener (app/_layout.tsx) to redirect away early.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const codeValid = /^\d{6}$/.test(code);
  const canSubmit = codeValid && !busy && !!email;

  async function handleSubmit() {
    setAttempted(true);
    if (!canSubmit || !email) return;
    setBusy(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    // Straight back into the app, not a forced set-new-password screen
    // (changed 2026-10-16, user request): verifyOtp already establishes a
    // real, fully usable session — the old password still "works" until the
    // user actively changes it (now a voluntary action from profile.tsx),
    // but there's no reason to block re-entry on that. Routes through "/"
    // rather than hardcoding "/profile" so Splash's own
    // subAccountNumber-aware redirect (app/index.tsx) decides where to
    // land, instead of duplicating that logic here.
    router.replace('/');
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
        {/* Navy header strip matching email-auth.tsx (user request 2026-10-16). */}
        <View className="flex-row items-center gap-2 px-4 pb-4 pt-14" style={{ backgroundColor: colors.royalBlue }}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/email-auth'))}
            hitSlop={12}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />
          </Pressable>
          <FeedbookWordmark size={26} color="#FFFFFF" />
        </View>

        <View className="flex-1 px-6 pt-4">
          <Text className="mb-1 text-2xl font-bold text-[#1B2430]">{t('enterResetCodeTitle')}</Text>
          <Text className="mb-6 text-sm text-[#6E6A61]">{t('resetCodeSentMessage')}</Text>

          <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]">{t('resetCode')}</Text>
          <Pressable
            onPress={() => {
              // Real bug (2026-10-16, user report): dismissing the keyboard
              // (swipe-down/system back) leaves this input still logically
              // focused in React's eyes even though the native keyboard is
              // gone — a known Android RN quirk where calling .focus() on an
              // already-"focused" input is a no-op, so tapping the boxes did
              // nothing. Explicitly blurring first forces a real focus
              // transition the next frame, which does bring the keyboard
              // back.
              inputRef.current?.blur();
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
            className="mb-1 justify-center gap-2"
            // A numeric code always reads left-to-right, in Hebrew too — RN
            // mirrors a plain 'row' under forced RTL (I18nManager.isRTL),
            // same as every other flex-row layout in this app, so this
            // cancels that mirroring back to a fixed left-to-right order
            // instead of showing the digits reversed.
            style={{ flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row' }}
          >
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <View
                key={i}
                className="h-14 w-11 items-center justify-center rounded-xl border bg-white"
                style={{ borderColor: i === code.length ? colors.royalBlue : '#E3DED2', borderWidth: i === code.length ? 2 : 1 }}
              >
                <Text className="text-xl font-semibold text-[#1B2430]">{code[i] ?? '_'}</Text>
              </View>
            ))}
            {/* The real input — invisible, captures typing/paste/autofill; the
                boxes above are purely a display driven by `code`. iOS reads
                textContentType="oneTimeCode" to offer the mailed code for
                autofill from the Mail app (same API also covers SMS), the
                same way it would a text message — there's no Android
                equivalent for an email-delivered code, but the system's own
                copy/paste suggestion still offers a code the user copied
                from Gmail manually. */}
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, CODE_LENGTH))}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              textContentType="oneTimeCode"
              autoFocus
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            />
          </Pressable>
          {attempted && !codeValid && (
            <Text className="mb-2 text-center text-xs text-[#DC2626]">{t('resetCodeInvalid')}</Text>
          )}
          <View className="mb-6" />

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            className="mb-4 items-center rounded-xl py-4"
            style={{ backgroundColor: canSubmit ? colors.royalBlue : '#C7C2B4' }}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? t('busyEllipsis') : t('continueLabel')}
            </Text>
          </Pressable>

          <Pressable onPress={() => void handleResend()} disabled={resending} hitSlop={8} className="items-center py-2">
            <Text className="text-sm text-[#1B3FA8]">{resending ? t('sendingEllipsis') : t('didntGetCode')}</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <ErrorModal
        visible={error !== null}
        title={t('codeVerificationFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}
