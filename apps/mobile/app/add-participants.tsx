import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, HeaderBackButton, HeaderMenu } from '../src/components/AppHeader';
import { ErrorModal } from '../src/components/ErrorModal';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { StepTabs } from '../src/components/StepTabs';
import { goBackOrHome } from '../src/lib/goBackOrHome';
import { useI18n } from '../src/lib/i18n';
import { supabase } from '../src/lib/supabase';
import { useTableSessionStore } from '../src/lib/tableSessionStore';
import { colors } from '../src/theme';

type Stage = 'consent' | 'contacts' | 'busy';

interface ContactRow {
  id: string;
  fullName: string;
  thumbnail: string | null;
}

// הוספת משתתפים (App Flow / Mobile UI Spec §5 + §6) — real mockups
// `6.1-AddFriends.JPG` and `6.2-SearchFriends.JPG`. The consent screen below
// is the literal Stage-4 DoD item: a row in `consents` must exist BEFORE the
// OS contacts permission dialog ever appears (PRD §12.2, Tech Stack §3) —
// never the other way around.
//
// Honest gap, not hidden: there is no backend endpoint yet that matches a
// phone's contacts against registered Feedbook accounts (would need a
// privacy-preserving lookup — hashed phone/email matching against
// auth.users — that hasn't been built). So granting contacts access here
// reads the device's real contact list but can't yet narrow it to "friends
// who have Feedbook" as the original spec describes; the empty state below
// says so explicitly instead of presenting an unrelated contact as a match.
// Tapping a contact toggles a local "selected" checkmark (matches the real
// mockup's UI) and drives the step-count badge, but — same honest-gap
// reason — it doesn't send anyone an invite yet: "המשך" always joins the
// signed-in user as the sole participant (host), which already works
// end-to-end today via the real join-session function.
//
// "בחרו מקום ישיבה" shows as already-done in the step bar: a physical
// per-table QR code already IS the seat choice (same reasoning documented
// in table-session.tsx) — there's no separate picking step to complete.
export default function AddParticipantsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const setTableSession = useTableSessionStore((s) => s.setTableSession);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    restaurantId: string;
    restaurantName: string;
    tableId: string;
    tableNumber: string;
    sessionId: string;
    sessionAccountNumber: string;
    qrToken: string;
  }>();

  const [stage, setStage] = useState<Stage>('consent');
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ContactRow>>(null);

  // FlatList doesn't reset its own scroll offset when its `data` prop
  // shrinks — real-device testing (2026-09-11) showed that scrolling down
  // the full contact list, then searching, left the (now short) filtered
  // list scrolled to that stale offset: an apparent large empty gap above
  // wherever the real match actually sits in the shrunk content, since the
  // viewport itself never moved back to the top. Pinning it to the top on
  // every keystroke keeps results directly under the search box.
  useEffect(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [query]);

  // Device back button/gesture operates at the router level and has no idea
  // this screen has its own internal consent → contacts stage machine — left
  // unhandled, back from `contacts` would skip straight past `consent` to
  // whatever real route is behind this one. Intercept it here instead, so
  // back always goes to the literal last screen shown, matching every other
  // screen's LIFO behavior (2026-09-10).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stage === 'contacts') {
        setStage('consent');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stage]);

  // Same reasoning as the BackHandler above, but for iOS's edge-swipe
  // gesture (BackHandler is Android-only and no-ops on iOS). Scoped to just
  // the `contacts` stage — not the whole screen — since a swipe back from
  // `consent` is a real, correct pop to restaurant-details with nothing to
  // bypass.
  //
  // 2026-09-11: this used to be a static `gestureEnabled: false` on the
  // route itself (via a <Stack.Screen> override in _layout.tsx) covering
  // the entire screen. Removed after a real device test showed the pop
  // transition losing its animation app-wide once that override existed —
  // disabling the gesture at the route-registration level appears to also
  // disable the underlying (non-gesture) pop animation in this react-
  // native-screens version, not just the swipe gesture itself. Toggling
  // gestureEnabled per-stage via setOptions has no such side effect.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: stage !== 'contacts' });
  }, [navigation, stage]);

  async function recordConsent(granted: boolean) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      await supabase.from('consents').upsert(
        { user_id: session.user.id, consent_type: 'contacts_access', granted },
        { onConflict: 'user_id,consent_type' },
      );
    }
  }

  async function handleAllowContacts() {
    await recordConsent(true);
    const { granted } = await requestPermissionsAsync();
    if (!granted) {
      setStage('contacts');
      return;
    }
    const details = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.THUMBNAIL]);
    setContacts(details.map((d) => ({ id: d.id, fullName: d.fullName ?? '', thumbnail: d.thumbnail ?? null })));
    setStage('contacts');
  }

  async function handleSkipContacts() {
    await recordConsent(false);
    setStage('contacts');
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleContinue() {
    setStage('busy');
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setStage('contacts');
      setError(t('sessionExpiredMessage'));
      return;
    }

    const { data, error: invokeError } = await supabase.functions.invoke<{
      participant: { id: string; sub_account_number: string; review_verification_code: string; is_host: boolean };
    }>('join-session', { body: { session_id: params.sessionId, invited_by_participant_id: null, qr_token: params.qrToken } });
    // participant.id (the row's own UUID) was already part of this response
    // shape — only sub_account_number/review_verification_code were being
    // read out before; place-order/call-waiter now need the real id too.

    if (invokeError || !data) {
      setStage('contacts');
      setError(t('joinFailedMessage'));
      return;
    }

    // Skip the old "הצטרפתם לשולחן!" confirmation screen (user request,
    // 2026-09-13) — go straight to the menu. Its content (account numbers)
    // now lives on the "ניהול חשבון" tab instead, sourced from this store
    // rather than route params, since switching tabs carries no params.
    setTableSession({
      sessionId: params.sessionId,
      participantId: data.participant.id,
      restaurantId: params.restaurantId,
      restaurantName: params.restaurantName,
      tableNumber: params.tableNumber,
      sessionAccountNumber: params.sessionAccountNumber,
      subAccountNumber: data.participant.sub_account_number,
      reviewVerificationCode: data.participant.review_verification_code,
    });
    router.push('/menu');
  }

  const filtered = contacts.filter((c) => c.fullName.includes(query));

  if (stage === 'consent') {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.background }}>
        <AppHeader
          right={
            <>
              <HeaderBackButton onPress={() => goBackOrHome(router)} />
              <FeedbookWordmark size={24} />
            </>
          }
          left={<HeaderMenu />}
        />
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: colors.royalBlueDark }}>
            <Ionicons name="people-outline" size={30} color="#FFFFFF" />
          </View>
          <Text className="mb-2 text-center text-2xl font-bold text-[#1B2430]">{t('addFriendsTitle')}</Text>
          <Text className="text-center text-base leading-6 text-[#6E6A61]">{t('contactsConsentBody')}</Text>
        </View>
        <View className="px-6" style={{ paddingBottom: insets.bottom + 16 }}>
          <Pressable onPress={() => void handleAllowContacts()} className="mb-3 items-center rounded-xl py-4" style={{ backgroundColor: colors.royalBlue }}>
            <Text className="text-lg font-semibold text-white">{t('allowContactsAccess')}</Text>
          </Pressable>
          <Pressable onPress={() => void handleSkipContacts()} className="items-center rounded-xl border py-4" style={{ borderColor: colors.border }}>
            <Text className="text-lg font-semibold text-[#1B2430]">{t('continueWithoutContacts')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (stage === 'busy') {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.royalBlue} />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {searching ? (
        <AppHeader
          right={
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchPlaceholder')}
              autoFocus
              className="w-56 text-base text-white"
              placeholderTextColor="rgba(255,255,255,0.7)"
            />
          }
          left={
            <HeaderBackButton
              onPress={() => {
                setSearching(false);
                setQuery('');
              }}
            />
          }
        />
      ) : (
        <AppHeader
          right={
            <>
              <HeaderBackButton onPress={() => setStage('consent')} />
              <FeedbookWordmark size={24} />
            </>
          }
          left={
            <>
              <Pressable onPress={() => setSearching(true)} hitSlop={8}>
                <Ionicons name="search-outline" size={24} color="#FFFFFF" />
              </Pressable>
              <HeaderMenu />
            </>
          }
        />
      )}

      <StepTabs
        steps={[
          { label: t('stepChooseSeat'), status: 'done' },
          { label: t('stepAddParticipants'), status: selectedIds.size },
        ]}
      />

      {/* Shown permanently (even with zero selections) per the diner-app
          owner's own request (2026-09-11) — not conditional on selectedIds
          anymore. This wrapping View — not the ScrollView's own `style`
          prop — is what actually enforces the fixed height: real-device
          testing kept showing this strip rendering far taller than the
          100 set directly on the ScrollView, through several rounds of
          fixes, even after a confirmed-fresh reload (Force Stop, not just
          backgrounding). Whatever the exact cause, a plain View with a hard
          height + overflow:'hidden' cannot be exceeded by whatever's
          inside it, so wrapping the ScrollView in one removes the
          ambiguity entirely instead of continuing to guess at the
          ScrollView's own sizing behavior. */}
      <View style={{ height: 64, overflow: 'hidden', borderBottomWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 12, paddingHorizontal: 16 }}
        >
          {/* justifyContent was 'center' before 2026-09-12 — real-device
              testing showed every chip centered in the strip instead of
              anchored to the right, misaligned with the contact avatars
              below it. 'flex-start' packs content from the layout's start
              edge (the right, under this app's forced RTL) instead of
              centering it — matching the avatar column's own alignment in
              the contact list (both use the same 16px horizontal padding). */}
          {/* Newest-selected should render at the physical right. The
              earlier ".reverse()" assumed a horizontal ScrollView mirrors
              under RTL the same way a plain flex-row View does elsewhere in
              this app (e.g. AppHeader.tsx) — real-device testing (2026-09-12)
              showed that assumption was wrong: RN's horizontal ScrollView is
              a documented RTL edge case where content mirrors differently
              from a plain row. Natural (non-reversed) Set insertion order is
              used instead — selectedIds already iterates oldest-first. */}
          {[...selectedIds]
            .map((id) => contacts.find((c) => c.id === id))
            .filter((c): c is ContactRow => c !== undefined)
            .map((c) => {
              const initial = c.fullName.trim().charAt(0).toUpperCase() || '?';
              return (
                // Same 44px size as the avatars in the contact list below
                // (h-11) — the larger 52px used here before looked clipped
                // against the carousel's fixed height on-device. No name
                // label anymore (owner's request) — just the avatar itself.
                <View key={c.id} style={{ position: 'relative', height: 44, width: 44 }}>
                  {c.thumbnail ? (
                    <Image source={{ uri: c.thumbnail }} style={{ height: 44, width: 44, borderRadius: 22 }} />
                  ) : (
                    <View
                      style={{ height: 44, width: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.royalBlue }}
                    >
                      <Text className="text-sm font-bold text-white">{initial}</Text>
                    </View>
                  )}
                  {/* Deselect shortcut straight from the carousel, matching
                      the real mockup (X badge on the avatar's lower corner)
                      — an alternative to tapping the contact again in the
                      list below, not a replacement for it. Fully inline
                      position (not the logical -end/-bottom classes used
                      elsewhere) so the side is never ambiguous. Real-device
                      testing (2026-09-11) showed `right: -4` landing on the
                      visual left in this RTL-forced app — React Native
                      mirrors absolute left/right for RTL the same way it
                      mirrors flex-row, unlike a plain CSS position — so
                      `left` is what actually renders on the physical right
                      here. */}
                  <Pressable
                    onPress={() => toggleSelected(c.id)}
                    hitSlop={8}
                    style={{
                      position: 'absolute',
                      bottom: -4,
                      left: -4,
                      height: 22,
                      width: 22,
                      borderRadius: 11,
                      borderWidth: 2,
                      borderColor: '#FFFFFF',
                      backgroundColor: '#D1D5DB',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="close" size={13} color="#4B5563" />
                  </Pressable>
                </View>
              );
            })}
        </ScrollView>
      </View>

      {filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="people-outline" size={32} color="#C7C2B4" />
          <Text className="mt-3 text-center text-sm text-[#9CA3AF]">
            {contacts.length === 0 ? t('noContactsYet') : t('noSearchResults')}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 16 }}
          renderItem={({ item }) => {
            const selected = selectedIds.has(item.id);
            const initial = item.fullName.trim().charAt(0).toUpperCase() || '?';
            return (
              <Pressable onPress={() => toggleSelected(item.id)} className="flex-row items-center gap-3 bg-white px-4 py-3">
                <View>
                  {item.thumbnail ? (
                    <Image source={{ uri: item.thumbnail }} className="h-11 w-11 rounded-full" />
                  ) : (
                    <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: colors.royalBlue }}>
                      <Text className="text-sm font-bold text-white">{initial}</Text>
                    </View>
                  )}
                  {selected && (
                    <View
                      className="absolute -end-0.5 -bottom-0.5 h-4 w-4 items-center justify-center rounded-full border-2 border-white"
                      style={{ backgroundColor: colors.royalBlue }}
                    >
                      <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                    </View>
                  )}
                </View>
                <Text className="flex-1 text-sm text-[#1B2430]">{item.fullName || t('noName')}</Text>
              </Pressable>
            );
          }}
        />
      )}

      <View className="bg-white px-6 pt-3" style={{ paddingBottom: insets.bottom + 16 }}>
        <View style={{ position: 'relative' }}>
          <Pressable onPress={() => void handleContinue()} className="items-center rounded-xl py-4" style={{ backgroundColor: colors.royalBlue }}>
            <Text className="text-lg font-semibold text-white">{t('finishAddParticipants')}</Text>
          </Pressable>
          <View
            className="items-center justify-center rounded-full bg-white"
            style={{ position: 'absolute', top: '50%', marginTop: -13, right: 14, height: 26, width: 26 }}
          >
            <Text className="text-xs font-bold" style={{ color: colors.royalBlue }}>
              {selectedIds.size}
            </Text>
          </View>
        </View>
      </View>

      <ErrorModal
        visible={error !== null}
        title={t('joinFailedTitle')}
        message={error ?? ''}
        dismissLabel={t('gotIt')}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}
