import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, Text, View, type ViewInstance } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useI18n, visualRowDirection, physicalReadingEnd, physicalReadingStart } from '../lib/i18n';
import type { Lang } from '../lib/translations';
import { useSession } from '../lib/useSession';
import { useNotifications } from '../lib/useNotifications';
import { useOpenSessionReminder } from '../lib/useOpenSessionReminder';
import { useTableSessionStore } from '../lib/tableSessionStore';
import { colors } from '../theme';

// Shared by HeaderMailIcon/HeaderBellIcon — an explicitly measured anchor
// (same approach as HeaderMenu's own "⋮" dropdown — see its openMenu/anchor
// comment). Real bug (2026-10-28): this used to be a fixed mt-24/items-end
// flex layout, tuned for one guessed icon position — on any screen where
// the mail/bell icon didn't actually sit there, or at a different header
// height, the panel opened in the wrong spot entirely. Two OTHER
// approaches were tried and reverted earlier (2026-10-18) — a buggy
// measureInWindow attempt that rendered fully off-screen, and
// react-native-popover-view's own auto-positioning, which landed badly off
// to the side under this app's forced-RTL layout.
// No speech-bubble tail (removed 2026-10-28, per explicit request) — a
// rotated-square tail hit a known Android elevation+rotation shadow
// mismatch, and a border-triangle redraw still didn't read as one unified
// shape; rather than keep chasing a pixel-perfect bubble notch without a
// real design-system component for it, the panel is just a plain anchored
// card now.
function BubblePanel({
  anchor,
  widthClassName = 'w-80',
  maxHeight,
  children,
}: {
  anchor: { top: number; left?: number; right?: number };
  widthClassName?: string;
  maxHeight?: number;
  children: ReactNode;
}) {
  return (
    <View
      className={`${widthClassName} overflow-hidden rounded-2xl bg-white`}
      style={{ position: 'absolute', top: anchor.top, left: anchor.left, right: anchor.right, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, maxHeight }}
    >
      {children}
    </View>
  );
}

// Shared measuring helper — same logic as HeaderMenu's own openMenu (see its
// comment): vertical anchor sits just below the icon; horizontal anchor
// picks whichever screen edge the icon is actually closer to.
// Real bug (2026-10-28, per explicit report — HeaderMailIcon's panel on
// profile.tsx rendering mostly off the left edge of the screen): this used
// to size the chosen edge's inset directly off the icon's own measured
// position with no awareness of the PANEL's own width — a panel anchored
// via `right` with a large inset (icon far from the right edge) could, once
// you subtract its own fixed width, land with a left edge well below 0.
// `panelWidth` lets this clamp both anchors so the panel's far edge can
// never cross the opposite side of the screen, regardless of where the
// icon measures to.
function measureAnchor(
  iconRef: { current: ViewInstance | null },
  setAnchor: (a: { top: number; left?: number; right?: number }) => void,
  panelWidth: number,
) {
  iconRef.current?.measureInWindow((x, y, width, height) => {
    const screenWidth = Dimensions.get('window').width;
    const top = y + height + 8;
    const maxInset = Math.max(16, screenWidth - panelWidth - 16);
    if (x + width / 2 > screenWidth / 2) {
      setAnchor({ top, right: Math.min(Math.max(16, screenWidth - (x + width)), maxInset) });
    } else {
      setAnchor({ top, left: Math.min(Math.max(16, x), maxInset) });
    }
  });
}

interface Props {
  // `right`/`left` name the actual screen position, not JSX order — which
  // side each one lands on is driven explicitly below, not by native
  // flex-row mirroring (see the real bug noted on that line).
  right: ReactNode;
  left: ReactNode;
}

// The shared navy top bar every real screen mockup uses
// (`פיתוחים/מסכי אפליקציה UI/Feedbook - מסכי האפליקציה/`: 3, 3.1, 5, 6.1,
// 6.2, 6.3) — same height/color/white-on-navy everywhere, only the two
// content slots differ per screen. Kept as a plain slot component rather
// than a fixed set of variants because the real header mixes its icons
// differently per screen (search icon here, QR pill there, a text action
// button elsewhere) — composing each screen's own icons through these two
// slots matches that better than forcing every combination into one enum.
export function AppHeader({ right, left }: Props) {
  // Real bug (2026-10-27): this used to be plain flex-row, relying entirely
  // on the native I18nManager.isRTL flag to mirror `right`/`left` into
  // their correctly-named positions — confirmed on a real device that this
  // flag can get stuck not reflecting Hebrew even after I18nManager.
  // forceRTL + a full app relaunch (see app/_layout.tsx's useRTLSync),
  // which silently swapped every header's icons to the wrong side with no
  // error. Driven explicitly through visualRowDirection instead, so this
  // renders correctly regardless of whether the native flag ever catches
  // up (see that function's own comment for why it's not a naive isRTL ?
  // 'row-reverse' : 'row').
  const { isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  return (
    <View style={{ flexDirection: rowDirection, alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.royalBlue }} className="px-4 pb-4 pt-16">
      <View style={{ flexDirection: rowDirection, alignItems: 'center' }} className="gap-3">{right}</View>
      <View style={{ flexDirection: rowDirection, alignItems: 'center' }} className="gap-3">{left}</View>
    </View>
  );
}

// Small reusable pieces, since the same icon shows up on several headers.
//
// Fixed 2026-09-14 (previously deferred — see project memory
// project_header_back_icon_rtl_bug): the icon used to be hardcoded to
// "arrow-forward" (a right-pointing arrow) regardless of language.
// Ionicons' arrow names are LTR-oriented and never auto-mirror — a
// right-pointing arrow reads correctly as "back" only under Hebrew's RTL
// flow; in English it pointed the wrong way. Now picked from the live
// language instead of assumed.
export function HeaderBackButton({ onPress }: { onPress: () => void }) {
  const { isRTL } = useI18n();
  return (
    <Pressable onPress={onPress} hitSlop={12} className="h-10 w-10 items-center justify-center">
      <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#FFFFFF" />
    </Pressable>
  );
}

const LANGUAGE_OPTIONS: { value: Lang; nativeLabel: string; flag: string }[] = [
  // Each language's own name shown in itself (standard picker convention),
  // not translated through t() — "עברית" doesn't become "Hebrew" in
  // English mode, same as any real app's language switcher. Flag is the
  // country most associated with the language (Israel/US), not every
  // country that speaks it — a simple, unambiguous per-language badge.
  { value: 'he', nativeLabel: 'עברית', flag: '🇮🇱' },
  { value: 'en', nativeLabel: 'English', flag: '🇺🇸' },
];

function LanguageFlag({ emoji }: { emoji: string }) {
  return (
    <View className="h-6 w-6 items-center justify-center overflow-hidden rounded-full" style={{ backgroundColor: colors.border }}>
      <Text style={{ fontSize: 14 }}>{emoji}</Text>
    </View>
  );
}

// The `⋮` icon — uniform and fixed on every screen's header outside the
// menu/order section, per the diner-app owner's explicit instruction. The
// menu/order route group (app/(ordering)/) uses the same dropdown but with a
// hamburger glyph instead, per the Stage 5 mockups' dual header-icon
// convention (2026-09-12) — pass `icon="menu-outline"` there. Currently
// offers "שפה/Language" (real — flips he/en app-wide, see src/lib/i18n.tsx)
// and "מטבע/Currency" (shown, locked — no multi-currency feature exists yet;
// same "show the future map, keep it inert" approach already used for
// profile's locked rows, not a stray dead button).
export function HeaderMenu({ icon = 'ellipsis-vertical' }: { icon?: 'ellipsis-vertical' | 'menu-outline' }) {
  const router = useRouter();
  const { lang, setLang, t, isRTL } = useI18n();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'language'>('menu');
  // Real bug (2026-10-28, per explicit request): the dropdown used to sit at
  // a fixed mt-24/items-end guess — a fixed top offset tuned for one
  // specific header height, AND a horizontal anchor hardcoded to the
  // screen's physical right edge regardless of where this icon actually
  // sits (this component is used from either of AppHeader's two slots, on
  // different screens) — so on any screen where the icon isn't on the
  // physical right, or whose header renders at a different height, the
  // panel opened in the wrong spot entirely, not under the icon. Measured
  // on open instead, both axes: vertical anchor is just below the icon;
  // horizontal anchor picks whichever screen edge the icon is actually
  // closer to and pins that same edge of the panel to it, so the panel
  // always opens hugging the icon regardless of which slot/screen it's in.
  // The fallback (96/end-anchored) is only ever shown for the single frame
  // before the first real measurement lands.
  const [anchor, setAnchor] = useState<{ top: number; left?: number; right?: number }>({ top: 96, right: 16 });
  const iconRef = useRef<ViewInstance>(null);

  function openMenu() {
    measureAnchor(iconRef, setAnchor, 224); // w-56
    setOpen(true);
  }
  // Only a diner with a live table (restaurantId set) has a restaurant to
  // view details for — pre-scan screens (sign-in, profile with no active
  // visit) never show this row.
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const restaurantName = useTableSessionStore((s) => s.restaurantName);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);

  function close() {
    setOpen(false);
    setView('menu');
  }

  return (
    <>
      <Pressable onPress={openMenu} hitSlop={10}>
        <View ref={iconRef}>
          <Ionicons name={icon} size={22} color="#FFFFFF" />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable className="flex-1 bg-black/40" onPress={close}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-56 overflow-hidden rounded-2xl bg-white"
            style={{ position: 'absolute', top: anchor.top, left: anchor.left, right: anchor.right, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}
          >
              {view === 'menu' ? (
                <>
                  {/* Reopens app/restaurant-details.tsx standalone, by
                      restaurantId, for a diner mid-visit — previously that
                      screen was reachable only once, right after scanning
                      (2026-10-18, user request). */}
                  {!!restaurantId && (
                    <Pressable
                      onPress={() => {
                        close();
                        router.push({
                          pathname: '/restaurant-details',
                          params: { restaurantId, restaurantName: restaurantName ?? '', tableNumber: tableNumber ?? '', standalone: '1' },
                        });
                      }}
                      className="items-center gap-3 border-b px-4 py-3.5"
                      style={{ flexDirection: visualRowDirection(isRTL), borderColor: colors.border }}
                    >
                      <Ionicons name="storefront-outline" size={20} color={colors.textMuted} />
                      <Text className="flex-1 text-sm text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                        {t('restaurantDetailsMenuItem')}
                      </Text>
                      <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textMuted} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => setView('language')} className="items-center gap-3 border-b px-4 py-3.5" style={{ flexDirection: visualRowDirection(isRTL), borderColor: colors.border }}>
                    <Ionicons name="language-outline" size={20} color={colors.textMuted} />
                    <Text className="flex-1 text-sm text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                      {t('languageMenuItem')}
                    </Text>
                    {/* Same RTL/LTR bug class as HeaderBackButton (fixed
                        2026-09-14, see project_header_back_icon_rtl_bug) — a
                        disclosure chevron points in the reading-forward
                        direction: left under RTL, right under LTR. */}
                    <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textMuted} />
                  </Pressable>
                  <View className="items-center gap-3 px-4 py-3.5" style={{ flexDirection: visualRowDirection(isRTL) }}>
                    <Ionicons name="cash-outline" size={20} color="#C7C2B4" />
                    <Text className="flex-1 text-sm text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                      {t('currencyMenuItem')}
                    </Text>
                    <Text className="text-xs text-[#C7C2B4]">{t('comingSoon')}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text className="px-4 pb-1 pt-3.5 text-xs font-semibold text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                    {t('chooseLanguageTitle')}
                  </Text>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        setLang(opt.value);
                        close();
                      }}
                      className="items-center gap-3 px-4 py-3.5"
                      style={{ flexDirection: visualRowDirection(isRTL) }}
                    >
                      <LanguageFlag emoji={opt.flag} />
                      <Text className="flex-1 text-sm text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                        {opt.nativeLabel}
                      </Text>
                      {lang === opt.value && <Ionicons name="checkmark" size={18} color={colors.royalBlue} />}
                    </Pressable>
                  ))}
                </>
              )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Account/promo messages (not order events — see HeaderBellIcon's own
// comment on that split). Self-contained like HeaderBellIcon, now with a
// real first message: the open-visit reminder (2026-10-16, user request) —
// see useOpenSessionReminder.ts for why this needs its own security
// definer RPC rather than a plain client query.
export function HeaderMailIcon() {
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const { session } = useSession();
  const { reminder, loading } = useOpenSessionReminder(session?.user.id);
  const currentSessionId = useTableSessionStore((s) => s.sessionId);
  const setTableSession = useTableSessionStore((s) => s.setTableSession);
  const [open, setOpen] = useState(false);
  // Measured anchor (2026-10-28), same approach as HeaderMenu's own "⋮"
  // dropdown and BubblePanel's own comment — replaces a fixed mt-24 guess.
  const [anchor, setAnchor] = useState<{ top: number; left?: number; right?: number }>({ top: 96, right: 16 });
  const iconRef = useRef<ViewInstance>(null);

  function openPanel() {
    measureAnchor(iconRef, setAnchor, 320); // w-80
    setOpen(true);
  }

  // The RPC finds this diner's most-recently-joined still-open session
  // regardless of whether they're currently sitting in it — so without this
  // check, the reminder (and its unread dot) kept showing even right after
  // tapping "התחברו לחשבון שלכם" and landing back in that exact session
  // (reported gap, 2026-10-18). Comparing against the live store's own
  // sessionId is what "already here, nothing to return to" actually means.
  const hasPendingReminder = !!reminder && reminder.sessionId !== currentSessionId;

  function handleReturn() {
    if (!reminder) return;
    // Resuming, not joining — no qr_token re-scan needed. The RPC already
    // proved this is a real, still-open session the caller legitimately
    // belongs to; this just restores the local store so OrderingHeader's
    // own screens have what they need, same as a real join-session
    // response would have set.
    setTableSession({
      sessionId: reminder.sessionId,
      participantId: reminder.participantId,
      restaurantId: reminder.restaurantId,
      restaurantName: reminder.restaurantName,
      tableId: reminder.tableId,
      tableNumber: reminder.tableNumber,
      tableType: reminder.tableType,
      sessionAccountNumber: reminder.sessionAccountNumber,
      subAccountNumber: reminder.subAccountNumber,
      barTicketNumber: reminder.barTicketNumber,
      reviewVerificationCode: reminder.reviewVerificationCode,
      qrToken: reminder.qrToken,
    });
    setOpen(false);
    router.replace('/menu');
  }

  return (
    <>
      <Pressable onPress={openPanel} hitSlop={10}>
        <View ref={iconRef}>
          <Ionicons name="mail-outline" size={24} color="#FFFFFF" />
          {/* Real bug (2026-10-28): `-end-0.5` is NativeWind's logical
              inset-end utility — resolves through the same stuck
              I18nManager.isRTL flag as RN's own `end` does (see i18n.tsx's
              physicalReadingEnd comment), not the actual language.
              Computed explicitly instead. */}
          {hasPendingReminder && (
            <View
              className="absolute -top-0.5 h-2 w-2 rounded-full"
              style={{ [physicalReadingEnd(isRTL)]: -2, backgroundColor: colors.danger }}
            />
          )}
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)}>
          <BubblePanel anchor={anchor}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Real bug (2026-10-28): plain full-width/flex-1 Texts below,
                  same textAlign:'auto' issue found across the rest of the
                  app — see i18n.tsx's physicalReadingStart comment. The
                  empty-state Text also moved from centered to right-aligned,
                  per explicit request (title and content both). */}
              <Text className="border-b px-4 py-3 text-sm font-bold text-[#1B2430]" style={{ borderColor: colors.border, textAlign: physicalReadingStart(isRTL) }}>
                {t('mailTitle')}
              </Text>
              {loading ? (
                <View className="items-center py-8">
                  <ActivityIndicator color={colors.royalBlue} />
                </View>
              ) : hasPendingReminder && reminder ? (
                // Same row shape as HeaderBellIcon's notification list (dot +
                // body text), per explicit request — this "inbox" only ever
                // holds at most this one item today, but it should still
                // read as one row in a list, not a one-off card+button.
                <Pressable onPress={handleReturn} className="items-start px-4 py-3" style={{ flexDirection: visualRowDirection(isRTL), gap: 8 }}>
                  <View className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.royalBlue }} />
                  <Text className="flex-1 text-sm leading-5 text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                    {t('openSessionReminderPrefix')}
                    <Text style={{ fontWeight: '700' }}>{reminder.restaurantName}</Text>
                    {t('openSessionReminderMiddle')}
                    <Text style={{ fontWeight: '700' }}>{reminder.tableNumber}</Text>
                    {t('openSessionReminderSuffix')}
                    <Text style={{ color: colors.skyLink, textDecorationLine: 'underline' }} onPress={handleReturn}>
                      {t('returnToSessionLink')}
                    </Text>
                  </Text>
                </Pressable>
              ) : (
                <Text className="px-4 py-6 text-sm text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {t('mailEmpty')}
                </Text>
              )}
            </Pressable>
          </BubblePanel>
        </Pressable>
      </Modal>
    </>
  );
}

// Menu/order section only (Stage 5 dual header-icon convention, 2026-09-12).
// Per the real mockups (9, 9.1 - Orders(Alerts)) this bell — not the mail
// icon, which is reserved for unrelated account/promo messages (see 3.1) —
// is the diner's own order-event feed: "your order was placed" /
// "your order was cancelled" (place_order_transaction /
// notify_order_item_cancelled, 20260919120000_order_event_notifications.sql).
// Self-contained like HeaderMenu (fetches its own data via useSession +
// useNotifications) rather than prop-drilled, so every (ordering) screen
// that renders OrderingHeader gets it for free.
export function HeaderBellIcon({ onNavigate }: { onNavigate?: (target: { orderId: string | null; orderItemId: string | null }) => void }) {
  const { t, isRTL } = useI18n();
  const { session } = useSession();
  const currentSessionId = useTableSessionStore((s) => s.sessionId);
  const { loading, notifications, unreadCount, markRead } = useNotifications(session?.user.id, currentSessionId);
  const [open, setOpen] = useState(false);
  // Measured anchor (2026-10-28) — same approach as HeaderMailIcon's own.
  const [anchor, setAnchor] = useState<{ top: number; left?: number; right?: number }>({ top: 96, right: 16 });
  const iconRef = useRef<ViewInstance>(null);

  function openPanel() {
    measureAnchor(iconRef, setAnchor, 320); // w-80
    setOpen(true);
  }

  return (
    <>
      <Pressable onPress={openPanel} hitSlop={10}>
        <View ref={iconRef}>
          <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
          {/* Real bug (2026-10-28): same `-end-*` logical-utility issue as
              HeaderMailIcon's own dot above — see that fix's comment. */}
          {unreadCount > 0 && (
            <View
              className="absolute -top-1.5 min-w-[16px] items-center justify-center rounded-full px-1"
              style={{ height: 16, backgroundColor: colors.danger, [physicalReadingEnd(isRTL)]: -6 }}
            >
              <Text className="text-[10px] font-bold leading-none text-white">{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)}>
          <BubblePanel anchor={anchor} maxHeight={384}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Real bug (2026-10-28): same textAlign fix as HeaderMailIcon's
                  own panel above — see that fix's comment. */}
              <Text className="border-b px-4 py-3 text-sm font-bold text-[#1B2430]" style={{ borderColor: colors.border, textAlign: physicalReadingStart(isRTL) }}>
                {t('notificationsTitle')}
              </Text>
              {loading ? (
                <View className="items-center py-8">
                  <ActivityIndicator color={colors.royalBlue} />
                </View>
              ) : notifications.length === 0 ? (
                <Text className="px-4 py-6 text-sm text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {t('notificationsEmpty')}
                </Text>
              ) : (
                // A plain View with maxHeight only clips overflow, it
                // doesn't scroll — older notifications past the visible
                // area were simply unreachable (reported gap). A real
                // ScrollView fixes that.
                <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled>
                  {notifications.map((n) => (
                    <Pressable
                      key={n.id}
                      onPress={() => {
                        if (n.readAt === null) void markRead(n.id);
                        if (n.relatedOrderId || n.relatedOrderItemId) {
                          setOpen(false);
                          onNavigate?.({ orderId: n.relatedOrderId, orderItemId: n.relatedOrderItemId });
                        }
                      }}
                      className="border-b px-4 py-3"
                      style={{ borderColor: colors.border }}
                    >
                      <View className="items-start" style={{ flexDirection: visualRowDirection(isRTL), gap: 8 }}>
                        {n.readAt === null && <View className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.royalBlue }} />}
                        <View className="flex-1">
                          <Text
                            className="text-sm"
                            style={{ fontWeight: n.readAt === null ? '700' : '400', color: n.readAt === null ? '#1B2430' : '#6E6A61', textAlign: physicalReadingStart(isRTL) }}
                          >
                            {n.title}
                          </Text>
                          <Text className="mt-0.5 text-xs text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                            {n.body}
                          </Text>
                          <Text className="mt-1 text-[10px] text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                            {new Date(n.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </Pressable>
          </BubblePanel>
        </Pressable>
      </Modal>
    </>
  );
}

export function HeaderTitle({ children }: { children: ReactNode }) {
  return <Text className="text-lg font-semibold text-white">{children}</Text>;
}
