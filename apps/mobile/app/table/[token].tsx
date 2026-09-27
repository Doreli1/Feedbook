import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../src/lib/useSession';
import { ErrorModal } from '../../src/components/ErrorModal';
import { resolveTableToken } from '../../src/lib/resolveTableToken';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'signed-in') return;
    let cancelled = false;
    void resolveTableToken(token, router).then((outcome) => {
      if (!cancelled && !outcome.ok) setError(t(outcome.messageKey));
    });
    return () => {
      cancelled = true;
    };
  }, [status, token, router, t]);

  if (status === 'signed-out') {
    router.replace('/sign-in');
    return null;
  }

  return (
    <View className="flex-1 items-center justify-center gap-3" style={{ backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.royalBlue} />
      <Text className="text-sm text-[#6E6A61]">{t('openingTable')}</Text>

      <ErrorModal
        visible={error !== null}
        title={t('openTableFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => router.replace('/profile')}
      />
    </View>
  );
}
