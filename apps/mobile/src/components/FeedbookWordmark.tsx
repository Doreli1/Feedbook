import { Text } from 'react-native';

interface Props {
  size?: number;
  color?: string;
}

// The one visual element that must match the Web Admin exactly — same font
// (Baloo 2, weight 700) as apps/web/src/index.css's .font-brand. Loaded via
// @expo-google-fonts/baloo-2 in app/_layout.tsx, which gates rendering until
// it's ready so this never flashes in the platform default font first.
export function FeedbookWordmark({ size = 24, color = '#FFFFFF' }: Props) {
  return <Text style={{ fontFamily: 'Baloo2_700Bold', fontSize: size, color }}>Feedbook</Text>;
}
