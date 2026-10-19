import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../lib/i18n';
import type { TranslationKey } from '../../lib/translations';
import { colors } from '../../theme';

interface Props {
  visible: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: (reason: string, reasonOther: string | null) => void;
}

// Same fixed-list-plus-"אחר" shape as CancelReasonModal.tsx, reused for
// the "end visit without an order" flow (2026-10-19, user request) — a
// distinct reason set and context, not a cancel action, so its own
// component rather than a generic prop-driven variant of that one.
const REASON_KEYS: TranslationKey[] = [
  'endVisitReasonOption1',
  'endVisitReasonOption2',
  'endVisitReasonOption3',
  'endVisitReasonOption4',
  'endVisitReasonOption5',
];

export function EndVisitReasonModal({ visible, busy, onBack, onConfirm }: Props) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<TranslationKey | 'other' | null>(null);
  const [otherText, setOtherText] = useState('');

  function reset() {
    setSelectedKey(null);
    setOtherText('');
  }

  function handleBack() {
    reset();
    onBack();
  }

  function handleConfirm() {
    if (selectedKey === null || busy) return;
    if (selectedKey === 'other') {
      const trimmed = otherText.trim();
      if (!trimmed) return;
      onConfirm('other', trimmed);
      return;
    }
    // Reason codes, not translated labels — matches session_participants.
    // left_reason's own enum (migration 20261019110000), independent of
    // whichever language the diner's device happens to be in.
    const codeByKey: Record<string, string> = {
      endVisitReasonOption1: 'menu_not_suitable',
      endVisitReasonOption2: 'prices_not_suitable',
      endVisitReasonOption3: 'joined_by_mistake',
      endVisitReasonOption4: 'just_browsing',
      endVisitReasonOption5: 'changed_mind',
    };
    onConfirm(codeByKey[selectedKey], null);
  }

  const canContinue = selectedKey !== null && (selectedKey !== 'other' || otherText.trim().length > 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleBack}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          <Text className="mb-3 text-lg font-bold text-[#1B2430]">{t('endVisitReasonTitle')}</Text>

          <View className="mb-1">
            {[...REASON_KEYS, 'other' as const].map((key, index) => {
              const isSelected = selectedKey === key;
              const isLast = index === REASON_KEYS.length;
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelectedKey(key)}
                  className="flex-row items-center gap-3 py-3"
                  style={!isLast ? { borderBottomWidth: 1, borderColor: colors.border } : undefined}
                >
                  <Text className="flex-1 text-sm text-[#1B2430]">{key === 'other' ? t('endVisitReasonOther') : t(key)}</Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color={colors.royalBlue} />}
                </Pressable>
              );
            })}
          </View>

          {selectedKey === 'other' && (
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              placeholder={t('endVisitReasonOtherPlaceholder')}
              placeholderTextColor="#9CA3AF"
              className="mb-2 mt-2 rounded-xl border px-4 py-3 text-sm text-[#1B2430]"
              style={{ borderColor: colors.border, minHeight: 44 }}
              multiline
              autoFocus
            />
          )}

          <View className="mt-4 flex-row-reverse" style={{ gap: 12 }}>
            <Pressable
              onPress={handleConfirm}
              disabled={!canContinue || busy}
              className="flex-1 items-center justify-center rounded-lg py-3"
              style={{ backgroundColor: canContinue && !busy ? colors.royalBlue : '#C7C2B4' }}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text className="font-semibold text-white">{t('endVisitReasonContinueButton')}</Text>}
            </Pressable>
            <Pressable onPress={handleBack} disabled={busy} className="flex-1 items-center rounded-lg border py-3" style={{ borderColor: colors.border }}>
              <Text className="font-semibold text-[#1B2430]">{t('endVisitReasonBackButton')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
