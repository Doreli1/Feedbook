import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { supabase } from '../lib/supabase';
import { useTableSessionStore } from '../lib/tableSessionStore';
import { ConfirmModal } from './ConfirmModal';
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

// The call-waiter POST, loading/called/error state — shared by every trigger
// that renders CallWaiterInlineTrigger (one per ordering tab, see
// OrderingScreen.tsx and AccountScreen.tsx), nothing UI-specific.
export function useCallWaiter() {
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

  return {
    calling,
    called,
    error,
    handlePress,
    dismissCalled: () => setCalled(false),
    dismissError: () => setError(false),
  };
}

// The confirmation + error modals, shared by every trigger instance so none
// of them copy/paste the pair.
function CallWaiterModals({
  called,
  error,
  onDismissCalled,
  onDismissError,
  t,
}: {
  called: boolean;
  error: boolean;
  onDismissCalled: () => void;
  onDismissError: () => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <>
      <WaiterCalledModal visible={called} onDismiss={onDismissCalled} t={t} />
      <ErrorModal visible={error} title={t('placeOrderFailedTitle')} message={t('callWaiterFailedMessage')} dismissLabel={t('gotIt')} onDismiss={onDismissError} />
    </>
  );
}

// App Flow §3.6: "האפליקציה מקצה לחצן קריאת שירות הזמין בכל שלב במהלך
// הביקור" — available at every stage of the visit. Originally a single
// screen-wide floating pill (see git history, removed 2026-10-10); now one
// instance per ordering tab, each embedded in that tab's own bottom strip
// (OrderingScreen.tsx for menu/orders, AccountScreen.tsx for account) rather
// than floating over whatever the tab renders at its own bottom — the
// floating version kept colliding with each tab's own bottom content
// (MenuBrowser's cart bar, AccountScreen's bill panel) with no reliable way
// for this component to know another screen's layout. Icon choice (round 3
// of 4, 2026-09-14, real-device feedback): a literal hotel concierge/
// reception bell — FontAwesome5's "concierge-bell" — after "hand-left-
// outline" read as a "stop" gesture and "megaphone-outline" didn't read as
// "call a waiter" specifically. A dedicated "waiter carrying a tray" glyph
// was requested in round 4 but doesn't exist in any bundled icon set
// (Ionicons, MaterialCommunityIcons, MaterialIcons, FontAwesome5/6, Feather,
// AntDesign, Octicons, Fontisto — checked all of them directly against the
// installed glyph maps), so concierge-bell stays. Label renders before the
// icon in JSX so it lands on the icon's right under native RTL.
export function CallWaiterInlineTrigger() {
  const { t } = useI18n();
  const { calling, called, error, handlePress, dismissCalled, dismissError } = useCallWaiter();
  // Accidental-tap guard (2026-10-11, user request): a real-world miss-tap
  // sends a waiter across the restaurant for nothing. ConfirmModal is the
  // same reusable "explain + undo route" component already used for sign-out
  // (profile.tsx) — not a one-off built just for this.
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Pressable onPress={() => setConfirmOpen(true)} disabled={calling} accessibilityRole="button" className="flex-row items-center gap-2">
        <Text className="text-sm font-semibold" style={{ color: colors.royalBlueDark }}>
          {t('callWaiterButton')}
        </Text>
        <View className="items-center justify-center rounded-full" style={{ height: 36, width: 36, backgroundColor: colors.royalBlueDark }}>
          {calling ? <ActivityIndicator color="#FFFFFF" size="small" /> : <FontAwesome5 name="concierge-bell" size={15} color="#FFFFFF" />}
        </View>
      </Pressable>

      <ConfirmModal
        visible={confirmOpen}
        title={t('callWaiterConfirmPromptTitle')}
        message={t('callWaiterConfirmPromptMessage')}
        cancelLabel={t('cancel')}
        confirmLabel={t('continueLabel')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void handlePress();
        }}
      />

      <CallWaiterModals called={called} error={error} onDismissCalled={dismissCalled} onDismissError={dismissError} t={t} />
    </>
  );
}
