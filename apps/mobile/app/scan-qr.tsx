import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, HeaderBackButton, HeaderMenu } from '../src/components/AppHeader';
import { ErrorModal } from '../src/components/ErrorModal';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { goBackOrHome } from '../src/lib/goBackOrHome';
import { resolveTableToken } from '../src/lib/resolveTableToken';
import { useI18n } from '../src/lib/i18n';
import { colors } from '../src/theme';

// A physical QR code encodes the deep link `feedbook://table/<qr_token>` (app
// scheme from app.json) so the same code also works when opened outside the
// app (a phone's own camera app) — that path is handled by the matching
// expo-router route at app/table/[token].tsx, which shares resolveTableToken
// with this screen's in-app scan path below.
export function extractQrToken(scanned: string): string | null {
  const deepLinkMatch = scanned.match(/^feedbook:\/\/table\/(.+)$/);
  if (deepLinkMatch) return deepLinkMatch[1];
  // Fallback: a QR printed with just the bare token, no deep-link wrapper.
  if (/^[A-Za-z0-9-]{8,}$/.test(scanned)) return scanned;
  return null;
}

// M-06 · סריקת QR (Mobile UI Spec §5). A valid code goes straight to M-07
// (add participants) with the restaurant/table/session it resolved — never
// back to a home screen. An invalid code surfaces the shared M-09 error
// modal rather than a silent failure or crash, per AFD §5.
export default function ScanQrScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  async function handleScanned(result: BarcodeScanningResult) {
    if (handledRef.current) return;
    const qrToken = extractQrToken(result.data);
    if (!qrToken) {
      handledRef.current = true;
      setScanning(false);
      setError(t('invalidQrScanned'));
      return;
    }

    handledRef.current = true;
    setScanning(false);

    const outcome = await resolveTableToken(qrToken, router, { navigate: 'push' });
    if (!outcome.ok) setError(t(outcome.messageKey));
  }

  function retry() {
    setError(null);
    handledRef.current = false;
    setScanning(true);
  }

  // Reached via `push` now (2026-09-10, LIFO back-navigation), so this
  // screen stays mounted underneath restaurant-details/add-participants
  // instead of unmounting — a real bug this surfaced: scanning/handledRef
  // stayed frozen at their post-scan values (camera off, one-shot guard
  // tripped), so returning here via back showed a dead black screen with
  // only the green frame overlay, no live camera. Focus is the right signal
  // to reset: it fires both on the very first mount and every time the user
  // comes back to this exact screen, and the cleanup (blur) turns the
  // camera off while another screen covers it instead of leaving it running
  // unseen.
  useFocusEffect(
    useCallback(() => {
      setScanning(true);
      setError(null);
      handledRef.current = false;
      return () => setScanning(false);
    }, []),
  );

  if (!permission) {
    return <View className="flex-1" style={{ backgroundColor: colors.ink }} />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-8" style={{ backgroundColor: colors.ink }}>
        <Ionicons name="camera-outline" size={40} color="#FFFFFF" />
        <Text className="text-center text-base text-white">{t('cameraPermissionMessage')}</Text>
        <Pressable onPress={() => void requestPermission()} className="rounded-xl px-6 py-3" style={{ backgroundColor: colors.royalBlue }}>
          <Text className="font-semibold text-white">{t('grantCameraAccess')}</Text>
        </Pressable>
        <Pressable onPress={() => goBackOrHome(router)} className="py-2">
          <Text className="text-sm text-white/70">{t('back')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.ink }}>
      <AppHeader
        right={
          <>
            <HeaderBackButton onPress={() => goBackOrHome(router)} />
            <FeedbookWordmark size={24} />
          </>
        }
        left={<HeaderMenu />}
      />
      <View className="items-center bg-white py-3">
        <Text className="text-center text-sm text-[#6E6A61]">{t('scanQrInstruction')}</Text>
      </View>

      <View className="flex-1">
        {scanning && (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(result) => void handleScanned(result)}
          />
        )}

        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <View className="h-64 w-64 rounded-2xl border-2" style={{ borderColor: colors.success }} />
        </View>
      </View>

      <ErrorModal
        visible={error !== null}
        title={t('scanFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('tryAgain')}
        onDismiss={retry}
      />
    </View>
  );
}
