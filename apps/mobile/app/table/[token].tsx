import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/useSession';
import { ErrorModal } from '../../src/components/ErrorModal';
import { resolveTableToken, buildScanFailureMessage, type ScanFailure } from '../../src/lib/resolveTableToken';
import { useI18n } from '../../src/lib/i18n';
import { colors } from '../../src/theme';

// expo-router maps `feedbook://table/<token>` straight to this file by path
// — the "Deep Link opens the app directly" half of M-06 (Stage 3 DoD item),
// distinct from scan-qr.tsx's in-app camera path but sharing its exact
// resolve logic via resolveTableToken.
//
// Known simplification: a cold start with no session (link tapped before
// ever signing in) redirects to sign-in and the token is lost — resuming the
// original deep link after sign-in would need carrying it through the auth
// screens, not implemented here yet.
export default function TableDeepLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { status } = useSession();
  const router = useRouter();
  const { t } = useI18n();
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  // Guards against resolving the SAME token twice (2026-11-03, real "stuck
  // in a loop" report: dismissing the closed-restaurant modal didn't
  // navigate away, it just reappeared) — keyed on the token itself, not a
  // bare boolean, so a genuinely different deep link (a fresh mount with a
  // new token) still resolves normally. Covers any re-render that would
  // otherwise re-fire this effect (e.g. a `router` reference change) rather
  // than relying on `useEffect` only running once in practice.
  const resolvedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'signed-in' || resolvedTokenRef.current === token) return;
    resolvedTokenRef.current = token;
    let cancelled = false;
    void resolveTableToken(token, router).then((outcome) => {
      if (!cancelled && !outcome.ok) setFailure(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [status, token, router]);

  if (status === 'signed-out') {
    router.replace('/sign-in');
    return null;
  }

  return (
    <View className="flex-1 items-center justify-center gap-3" style={{ backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.royalBlue} />
      <Text className="text-sm text-[#6E6A61]">{t('openingTable')}</Text>

      <ErrorModal
        visible={failure !== null}
        title={
          failure?.tone !== 'info'
            ? t('openTableFailedTitle')
            : // Each 'info' outcome gets its own specific title —
              // messageKey already distinguishes them, no extra field
              // needed on ScanFailure to pick the right one.
              failure.messageKey === 'barClosedScanMessage'
                ? t('barClosedTitle')
                : failure.messageKey === 'tableArchived'
                  ? t('tableArchivedTitle')
                  : t('restaurantClosedTitle')
        }
        message={failure ? buildScanFailureMessage(failure, t) : ''}
        dismissLabel={t('gotIt')}
        tone={failure?.tone}
        onDismiss={() => {
          // Clears the modal before navigating (2026-11-03, same loop fix
          // as the resolvedTokenRef guard above) — belt-and-suspenders so
          // the modal can never still read as visible if this screen
          // lingers mounted for a tick during the route replace.
          setFailure(null);
          router.replace('/profile');
        }}
      />
    </View>
  );
}
