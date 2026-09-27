import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, HeaderMenu } from '../src/components/AppHeader';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { StepTabs } from '../src/components/StepTabs';
import { useI18n } from '../src/lib/i18n';
import { colors } from '../src/theme';

// Adapted M-08 destination: the original spec (Mobile UI Spec §5, M-08)
// describes an interactive table map the diner picks a seat from. The actual
// Stage 3 backend doesn't support that — scan-qr resolves ONE specific table
// from its own printed QR token, and RLS deliberately blocks a diner from
// browsing `tables` directly (see scan-qr/index.ts's own comment) so guests
// can't enumerate a restaurant's seating. A physical per-table QR code
// already IS the seat choice. This screen shows the real, already-resolved
// session instead of a picker with nothing behind it — menu browsing
// (Milestone 5) is the next real screen from here, not built yet.
export default function TableSessionScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{
    restaurantName: string;
    tableNumber: string;
    sessionAccountNumber: string;
    subAccountNumber: string;
  }>();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <AppHeader right={<FeedbookWordmark size={20} />} left={<HeaderMenu />} />
      <StepTabs
        steps={[
          { label: t('stepChooseSeat'), status: 'done' },
          { label: t('stepAddParticipants'), status: 'done' },
        ]}
      />

      <View className="flex-1 items-center justify-center px-8">
        <View className="mb-5 h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: colors.successSoft }}>
          <Ionicons name="checkmark-circle-outline" size={34} color={colors.success} />
        </View>
        <Text className="mb-1 text-center text-xl font-bold text-[#1B2430]">{t('joinedTableTitle')}</Text>
        <Text className="mb-6 text-center text-sm text-[#6E6A61]">
          {params.restaurantName} · {t('tableLabel')} {params.tableNumber}
        </Text>

        <View className="mb-6 w-full rounded-xl bg-white p-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <View className="flex-row justify-between py-1.5">
            <Text className="text-sm text-[#6E6A61]">{t('tableAccountNumber')}</Text>
            <Text className="text-sm font-semibold text-[#1B2430]">{params.sessionAccountNumber}</Text>
          </View>
          <View className="flex-row justify-between py-1.5">
            <Text className="text-sm text-[#6E6A61]">{t('subAccountNumber')}</Text>
            <Text className="text-sm font-semibold text-[#1B2430]">{params.subAccountNumber}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/menu')}
          className="mb-3 w-full items-center rounded-xl py-4"
          style={{ backgroundColor: colors.royalBlue }}
        >
          <Text className="text-base font-semibold text-white">{t('continueToMenu')}</Text>
        </Pressable>
        <Text className="text-center text-xs leading-5 text-[#9CA3AF]">{t('menuComingSoon')}</Text>
      </View>
    </View>
  );
}
