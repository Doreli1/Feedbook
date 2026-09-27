import { useEffect } from 'react';
import { Text, View } from 'react-native';

interface Props {
  visible: boolean;
  message: string;
  onHide: () => void;
  durationMs?: number;
}

// M-10 (Mobile UI Spec §5) — short green confirmation, then automatic return
// to the screen where the change is already visible. The screen itself
// handles navigating back in onHide; this component only owns the timer.
export function SuccessToast({ visible, message, onHide, durationMs = 2200 }: Props) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onHide, durationMs);
    return () => clearTimeout(timer);
  }, [visible, durationMs, onHide]);

  if (!visible) return null;

  return (
    <View className="absolute inset-x-4 top-14 z-50 items-center">
      <View className="flex-row items-center rounded-full bg-[#22C55E] px-5 py-3 shadow-lg">
        <Text className="font-semibold text-white">{message}</Text>
      </View>
    </View>
  );
}
