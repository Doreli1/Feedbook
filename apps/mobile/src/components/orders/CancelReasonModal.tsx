import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../lib/i18n';
import type { TranslationKey } from '../../lib/translations';
import { colors } from '../../theme';

interface Props {
  visible: boolean;
  onBack: () => void;
  onConfirm: (reason: string) => void;
}

const REASON_KEYS: TranslationKey[] = ['cancelReasonOption1', 'cancelReasonOption2', 'cancelReasonOption3', 'cancelReasonOption4'];

// Shown before a cancel request is actually sent (requested 2026-09-19) —
// a fixed reason list + free-text "אחר", "חזור"/"המשך" buttons matching the
// same two-button layout as ConfirmModal.tsx. The picked reason (or typed
// text) is stored server-side on the order_item and surfaced to staff, per
// the confirmed answer when this was scoped — not a client-only UX gate.
export function CancelReasonModal({ visible, onBack, onConfirm }: Props) {
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
    if (selectedKey === null) return;
    const reason = selectedKey === 'other' ? otherText.trim() : t(selectedKey);
    if (!reason) return;
    reset();
    onConfirm(reason);
  }

  const canContinue = selectedKey !== null && (selectedKey !== 'other' || otherText.trim().length > 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleBack}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          <Text className="mb-3 text-lg font-bold text-[#1B2430]">{t('cancelReasonTitle')}</Text>

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
                  <Text className="flex-1 text-sm text-[#1B2430]">{key === 'other' ? t('cancelReasonOther') : t(key)}</Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color={colors.royalBlue} />}
                </Pressable>
              );
            })}
          </View>

          {selectedKey === 'other' && (
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              placeholder={t('cancelReasonOtherPlaceholder')}
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
              disabled={!canContinue}
              className="flex-1 items-center rounded-lg py-3"
              style={{ backgroundColor: canContinue ? colors.royalBlue : '#C7C2B4' }}
            >
              <Text className="font-semibold text-white">{t('cancelReasonContinueButton')}</Text>
            </Pressable>
            <Pressable onPress={handleBack} className="flex-1 items-center rounded-lg border py-3" style={{ borderColor: colors.border }}>
              <Text className="font-semibold text-[#1B2430]">{t('cancelReasonBackButton')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
