import { Modal, Pressable, Text, View } from 'react-native';
import { useI18n, physicalReadingStart } from '../lib/i18n';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
}

// M-09 (Mobile UI Spec §5) — a red title, an exact explanation of what went
// wrong, and where to go next — never a bare "משהו השתבש". Reused for every
// blocked action across the app (invalid QR, inactive table, auth failure).
export function ErrorModal({ visible, title, message, dismissLabel, onDismiss }: Props) {
  const { isRTL } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          {/* Real bug (2026-10-28): plain full-width Texts, same
              textAlign:'auto' issue found across the rest of the app —
              this one is shared by every blocked-action error across the
              app, so the fix covers all of them at once. */}
          <Text className="mb-2 text-lg font-bold text-[#DC2626]" style={{ textAlign: physicalReadingStart(isRTL) }}>
            {title}
          </Text>
          <Text className="mb-5 text-sm leading-5 text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
            {message}
          </Text>
          <Pressable onPress={onDismiss} className="items-center rounded-lg bg-[#1B3FA8] py-3">
            <Text className="font-semibold text-white">{dismissLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
