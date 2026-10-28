import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, HeaderMailIcon, HeaderMenu } from '../src/components/AppHeader';
import { ConfirmModal } from '../src/components/ConfirmModal';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n, visualRowDirection, physicalReadingStart, visualColumnAlign } from '../src/lib/i18n';
import type { TranslationKey } from '../src/lib/translations';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';
import type { Session } from '@supabase/supabase-js';

interface LockedRow {
  key: string;
  labelKey: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
}

// Visible from day one so the user sees the app's full map immediately (same
// approach already used for Web Admin's Stock/Tables) — content stays
// empty/locked until its own milestone (Mobile UI Spec §1.2 table).
const LOCKED_ROWS: LockedRow[] = [
  { key: 'past-orders', labelKey: 'pastOrders', icon: 'receipt-outline' }, // Milestone 5
  { key: 'reviews', labelKey: 'myReviews', icon: 'star-outline' }, // Milestone 7
  { key: 'favorites', labelKey: 'myFavorites', icon: 'heart-outline' }, // Milestone 5
];

export default function ProfileScreen() {
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const current = sessionData.session;
      if (cancelled || !current) return;
      setSession(current);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('display_name')
        .eq('user_id', current.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (profile) {
        setDisplayName(profile.display_name);
        return;
      }

      // No row yet (no trigger creates one on sign-up) — seed a sensible
      // default from the email's local part so the screen never shows a
      // blank name, then keep it for next time.
      const fallbackName = current.user.email?.split('@')[0] ?? t('defaultDinerName');
      await supabase.from('user_profiles').upsert({ user_id: current.user.id, display_name: fallbackName });
      if (!cancelled) setDisplayName(fallbackName);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const initial = (displayName ?? '?').trim().charAt(0).toUpperCase();

  function openEditName() {
    setNameDraft(displayName ?? '');
    setEditingName(true);
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || !session) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    await supabase.from('user_profiles').upsert({ user_id: session.user.id, display_name: trimmed });
    setSavingName(false);
    setDisplayName(trimmed);
    setEditingName(false);
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <AppHeader
        right={<FeedbookWordmark size={24} />}
        left={
          <>
            <HeaderMailIcon />
            <Pressable
              onPress={() => router.push('/scan-qr')}
              className="items-center gap-2 rounded-full bg-white px-4 py-2.5"
              style={{ flexDirection: rowDirection }}
            >
              <Ionicons name="qr-code-outline" size={19} color={colors.royalBlue} />
              <Text className="text-sm font-semibold" style={{ color: colors.royalBlue }}>
                {t('activateQrScanner')}
              </Text>
            </Pressable>
            <HeaderMenu />
          </>
        }
      />

      <ScrollView className="flex-1 px-4 pt-6" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="mb-6 items-center gap-4" style={{ flexDirection: rowDirection }}>
          <View className="h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: colors.royalBlue }}>
            <Text className="text-2xl font-bold text-white">{initial}</Text>
          </View>
          {/* Real bug (2026-10-28): flex-1/stretched Texts with no explicit
              textAlign, and `self-start` on the badge below — same two
              issues already found and fixed in BurgerSideMenu's own
              identical avatar+name+badge block (see i18n.tsx's
              physicalReadingStart/visualColumnAlign comments): 'auto'
              textAlign and alignSelf flex-start/flex-end both resolve
              through the same stuck I18nManager.isRTL flag. */}
          <View className="flex-1">
            <Text className="text-xl font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {displayName ?? t('loadingEllipsis')}
            </Text>
            <Text className="text-sm text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {session?.user.email}
            </Text>
            <View
              className="mt-1.5 items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 py-1"
              style={{ flexDirection: rowDirection, alignSelf: visualColumnAlign(physicalReadingStart(isRTL)) }}
            >
              <Ionicons name="sparkles-outline" size={14} color="#B45309" />
              <Text className="text-xs font-semibold text-[#B45309]">{t('feedstarsLevel')}</Text>
            </View>
          </View>
        </View>

        <View className="mb-4 overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <Pressable onPress={openEditName} className="items-center gap-3 px-4 py-4" style={{ flexDirection: rowDirection }}>
            <Ionicons name="pencil-outline" size={22} color={colors.textMuted} />
            <Text className="flex-1 text-base text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('editProfile')}
            </Text>
          </Pressable>
          {/* Voluntary password change (2026-10-16, user request) — forgot-
              password's code verification now logs the diner straight back
              in instead of forcing a new password on them, so this is where
              that choice lives instead: optional, whenever they want it. */}
          <Pressable
            onPress={() => router.push('/set-new-password')}
            className="items-center gap-3 border-t px-4 py-4"
            style={{ flexDirection: rowDirection, borderColor: colors.border }}
          >
            <Ionicons name="key-outline" size={22} color={colors.textMuted} />
            <Text className="flex-1 text-base text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('changePassword')}
            </Text>
          </Pressable>
        </View>

        <View className="overflow-hidden rounded-xl bg-white" style={{ borderColor: colors.border, borderWidth: 1 }}>
          {LOCKED_ROWS.map((row, i) => (
            <View
              key={row.key}
              className={`items-center gap-3 px-4 py-4 ${i > 0 ? 'border-t' : ''}`}
              style={{ flexDirection: rowDirection, borderColor: colors.border }}
            >
              <Ionicons name={row.icon} size={22} color={colors.textMuted} />
              <Text className="flex-1 text-base text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                {t(row.labelKey)}
              </Text>
              <Ionicons name="lock-closed-outline" size={18} color="#C7C2B4" />
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="px-4 pt-3" style={{ backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }}>
        <Pressable
          onPress={() => setConfirmingSignOut(true)}
          className="items-center rounded-lg py-3.5"
          style={{ backgroundColor: colors.danger }}
        >
          <Text className="text-base font-semibold text-white">{t('signOut')}</Text>
        </Pressable>
      </View>

      <Modal visible={editingName} transparent animationType="fade" onRequestClose={() => setEditingName(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            {/* Real bug (2026-10-28): plain full-width Texts, same
                textAlign:'auto' issue found across the rest of the app —
                see i18n.tsx's physicalReadingStart comment. TextInput has
                the exact same 'auto' default for its own typed text. */}
            <Text className="mb-3 text-lg font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('editProfile')}
            </Text>
            <Text className="mb-1.5 text-xs font-semibold text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
              {t('displayName')}
            </Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              className="mb-5 rounded-xl border px-4 py-3 text-base text-[#1B2430]"
              style={{ borderColor: colors.border, textAlign: physicalReadingStart(isRTL) }}
              autoFocus
            />
            <View className="gap-3" style={{ flexDirection: visualRowDirection(!isRTL) }}>
              <Pressable
                onPress={() => void saveName()}
                disabled={savingName || !nameDraft.trim()}
                className="flex-1 items-center rounded-lg py-3"
                style={{ backgroundColor: colors.royalBlue, opacity: savingName || !nameDraft.trim() ? 0.6 : 1 }}
              >
                <Text className="font-semibold text-white">{savingName ? t('savingEllipsis') : t('save')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setEditingName(false)}
                className="flex-1 items-center rounded-lg border py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="font-semibold text-[#1B2430]">{t('cancel')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={confirmingSignOut}
        title={t('signOutConfirmTitle')}
        message={t('signOutConfirmMessage')}
        cancelLabel={t('cancel')}
        confirmLabel={t('continueLabel')}
        danger
        onCancel={() => setConfirmingSignOut(false)}
        onConfirm={() => {
          setConfirmingSignOut(false);
          void supabase.auth.signOut();
        }}
      />
    </View>
  );
}
