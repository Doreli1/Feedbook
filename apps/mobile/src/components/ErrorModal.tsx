import { Modal, Pressable, Text, View } from 'react-native';

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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          <Text className="mb-2 text-lg font-bold text-[#DC2626]">{title}</Text>
          <Text className="mb-5 text-sm leading-5 text-[#6E6A61]">{message}</Text>
          <Pressable onPress={onDismiss} className="items-center rounded-lg bg-[#1B3FA8] py-3">
            <Text className="font-semibold text-white">{dismissLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
