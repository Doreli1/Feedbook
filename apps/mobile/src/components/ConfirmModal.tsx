import { Modal, Pressable, Text, View } from 'react-native';

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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          <Text className="mb-2 text-lg font-bold text-[#1B2430]">{title}</Text>
          <Text className="mb-5 text-sm leading-5 text-[#6E6A61]">{message}</Text>
          <View className="flex-row-reverse gap-3">
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
