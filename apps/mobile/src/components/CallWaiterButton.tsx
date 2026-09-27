import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { supabase } from '../lib/supabase';
import { useTableSessionStore } from '../lib/tableSessionStore';
import { ErrorModal } from './ErrorModal';
import { colors } from '../theme';

// A distinct, non-error confirmation — ErrorModal's title is always red
// (correctly, for the many real errors it's shared for), so "your call was
// sent" gets its own small modal rather than borrowing that red styling.
function WaiterCalledModal({ visible, onDismiss, t }: { visible: boolean; onDismiss: () => void; t: (key: TranslationKey) => string }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm items-center rounded-2xl bg-white p-5">
          <View className="mb-3 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: colors.successSoft }}>
            <Ionicons name="checkmark" size={26} color={colors.success} />
          </View>
          <Text className="mb-2 text-center text-lg font-bold text-[#1B2430]">{t('callWaiterConfirmTitle')}</Text>
          <Text className="mb-5 text-center text-sm leading-5 text-[#6E6A61]">{t('callWaiterConfirmMessage')}</Text>
          <Pressable onPress={onDismiss} className="w-full items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
            <Text className="font-semibold text-white">{t('gotIt')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// App Flow §3.6: "האפליקציה מקצה לחצן קריאת שירות הזמין בכל שלב במהלך
// הביקור" — available at every stage of the visit, not just the Orders tab.
// Moved here from OrderTracker.tsx (2026-09-14, real-device feedback: the
// original full-width bar on the Orders tab read as visually heavy/competing
// with the order cards' own cancel buttons, and wasn't reachable from the
// other two tabs at all). Rendered once at OrderingScreen level so it stays
// mounted across all three tabs.
//
// 2026-09-14 (third round, real-device feedback):
// - round 1: "hand-left-outline" — read as a "stop" gesture, no label.
// - round 2: "megaphone-outline" + label — still didn't read as "call a
//   waiter" specifically.
// - round 3: a literal hotel concierge/reception bell — FontAwesome5's
//   "concierge-bell" (the classic bell-on-a-stand-with-a-push-button glyph).
//   A dedicated "waiter carrying a tray" glyph was requested in round 4 but
//   doesn't exist in any bundled icon set (Ionicons, MaterialCommunityIcons,
//   MaterialIcons, FontAwesome5/6, Feather, AntDesign, Octicons, Fontisto —
//   checked all of them directly against the installed glyph maps) — a
//   custom illustration asset would be a separate scope decision (this app
//   has no image-icon pipeline anywhere else), so concierge-bell stays.
//
// 2026-09-14 (round 4, real-device feedback): the fixed `bottom: 20` didn't
// account for Android's own navigation bar — on a device with 3-button nav
// (not gesture nav), that bar sits ON TOP of a plain absolute position,
// causing the exact collision reported. `useSafeAreaInsets()` (already used
// elsewhere in this app, e.g. add-participants.tsx) reports that bar's real
// height at runtime; adding it to the base offset keeps the button above it
// on every device, not just ones with gesture navigation.
export function CallWaiterButton() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const [calling, setCalling] = useState(false);
  const [called, setCalled] = useState(false);
  const [error, setError] = useState(false);

  async function handlePress() {
    if (!sessionId || calling) return;
    setCalling(true);
    const { data, error: invokeError } = await supabase.functions.invoke<{ error?: { code: string } }>('call-waiter', {
      body: { session_id: sessionId },
    });
    setCalling(false);
    if (invokeError || data?.error) {
      setError(true);
      return;
    }
    setCalled(true);
  }

  return (
    <>
      <Pressable
        onPress={() => void handlePress()}
        disabled={calling}
        accessibilityRole="button"
        className="flex-row items-center rounded-full px-4 py-3"
        style={{
          position: 'absolute',
          bottom: insets.bottom + 20,
          insetInlineEnd: 16,
          gap: 8,
          backgroundColor: colors.royalBlueDark,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 5,
        }}
      >
        {calling ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <FontAwesome5 name="concierge-bell" size={17} color="#FFFFFF" />
            <Text className="text-sm font-semibold text-white">{t('callWaiterButton')}</Text>
          </>
        )}
      </Pressable>

      <WaiterCalledModal visible={called} onDismiss={() => setCalled(false)} t={t} />
      <ErrorModal visible={error} title={t('placeOrderFailedTitle')} message={t('callWaiterFailedMessage')} dismissLabel={t('gotIt')} onDismiss={() => setError(false)} />
    </>
  );
}
