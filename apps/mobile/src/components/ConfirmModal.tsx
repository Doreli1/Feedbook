import { Modal, Pressable, Text, View } from 'react-native';
import { useI18n, visualRowDirection, physicalReadingStart } from '../lib/i18n';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// M-05 pattern (Mobile UI Spec §5) — Nielsen's "escape route": every critical
// action explains exactly what happens and how to undo it, with a real
// Cancel, never just a single "OK". Reused for any future critical
// confirmation, not just sign-out.
export function ConfirmModal({ visible, title, message, cancelLabel, confirmLabel, danger, onCancel, onConfirm }: Props) {
  const { isRTL } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          {/* Real bug (2026-10-28): plain full-width Texts, same
              textAlign:'auto' issue found across the rest of the app — this
              one is shared by every critical confirmation in the app
              (call-waiter, sign-out, …), so the fix covers all of them at
              once. */}
          <Text className="mb-2 w-full text-lg font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
            {title}
          </Text>
          <Text className="mb-5 w-full text-sm leading-5 text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
            {message}
          </Text>
          <View className="gap-3" style={{ flexDirection: visualRowDirection(!isRTL) }}>
            <Pressable
              onPress={onConfirm}
              className={`flex-1 items-center rounded-lg py-3 ${danger ? 'bg-[#DC2626]' : 'bg-[#1B3FA8]'}`}
            >
              <Text className="font-semibold text-white">{confirmLabel}</Text>
            </Pressable>
            <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-[#E3DED2] py-3">
              <Text className="font-semibold text-[#1B2430]">{cancelLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
