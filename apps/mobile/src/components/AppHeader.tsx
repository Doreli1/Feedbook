import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../lib/i18n';
import type { Lang } from '../lib/translations';
import { useSession } from '../lib/useSession';
import { useNotifications } from '../lib/useNotifications';
import { colors } from '../theme';

interface Props {
  // First child in a `flex-row` renders on the physical right in this
  // RTL-forced app (same convention already used throughout — see
  // profile.tsx/scan-qr.tsx) — `right`/`left` name the actual screen
  // position, not JSX order.
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
  return (
    <View className="flex-row items-center justify-between px-4 pb-4 pt-16" style={{ backgroundColor: colors.royalBlue }}>
      <View className="flex-row items-center gap-3">{right}</View>
      <View className="flex-row items-center gap-3">{left}</View>
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
  const { lang, setLang, t, isRTL } = useI18n();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'language'>('menu');

  function close() {
    setOpen(false);
    setView('menu');
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10}>
        <Ionicons name={icon} size={22} color="#FFFFFF" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable className="flex-1 bg-black/40" onPress={close}>
          <View className="mt-24 items-end px-4">
            <Pressable onPress={(e) => e.stopPropagation()} className="w-56 overflow-hidden rounded-2xl bg-white" style={{ elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}>
              {view === 'menu' ? (
                <>
                  <Pressable onPress={() => setView('language')} className="flex-row items-center gap-3 border-b px-4 py-3.5" style={{ borderColor: colors.border }}>
                    <Ionicons name="language-outline" size={20} color={colors.textMuted} />
                    <Text className="flex-1 text-sm text-[#1B2430]">{t('languageMenuItem')}</Text>
                    {/* Same RTL/LTR bug class as HeaderBackButton (fixed
                        2026-09-14, see project_header_back_icon_rtl_bug) — a
                        disclosure chevron points in the reading-forward
                        direction: left under RTL, right under LTR. */}
                    <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textMuted} />
                  </Pressable>
                  <View className="flex-row items-center gap-3 px-4 py-3.5">
                    <Ionicons name="cash-outline" size={20} color="#C7C2B4" />
                    <Text className="flex-1 text-sm text-[#9CA3AF]">{t('currencyMenuItem')}</Text>
                    <Text className="text-xs text-[#C7C2B4]">{t('comingSoon')}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text className="px-4 pb-1 pt-3.5 text-xs font-semibold text-[#6E6A61]">{t('chooseLanguageTitle')}</Text>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        setLang(opt.value);
                        close();
                      }}
                      className="flex-row items-center gap-3 px-4 py-3.5"
                    >
                      <LanguageFlag emoji={opt.flag} />
                      <Text className="flex-1 text-sm text-[#1B2430]">{opt.nativeLabel}</Text>
                      {lang === opt.value && <Ionicons name="checkmark" size={18} color={colors.royalBlue} />}
                    </Pressable>
                  ))}
                </>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function HeaderMailIcon({ unread }: { unread?: boolean }) {
  return (
    <View>
      <Ionicons name="mail-outline" size={24} color="#FFFFFF" />
      {unread && (
        <View className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ backgroundColor: colors.danger }} />
      )}
    </View>
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
  const { t } = useI18n();
  const { session } = useSession();
  const { loading, notifications, unreadCount, markRead } = useNotifications(session?.user.id);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10}>
        <View>
          <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
          {unreadCount > 0 && (
            <View
              className="absolute -end-1.5 -top-1.5 min-w-[16px] items-center justify-center rounded-full px-1"
              style={{ height: 16, backgroundColor: colors.danger }}
            >
              <Text className="text-[10px] font-bold leading-none text-white">{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)}>
          <View className="mt-24 items-end px-4">
            <Pressable
              onPress={(e) => e.stopPropagation()}
              className="max-h-96 w-80 overflow-hidden rounded-2xl bg-white"
              style={{ elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 }}
            >
              <Text className="border-b px-4 py-3 text-sm font-bold text-[#1B2430]" style={{ borderColor: colors.border }}>
                {t('notificationsTitle')}
              </Text>
              {loading ? (
                <View className="items-center py-8">
                  <ActivityIndicator color={colors.royalBlue} />
                </View>
              ) : notifications.length === 0 ? (
                <Text className="px-4 py-6 text-center text-sm text-[#9CA3AF]">{t('notificationsEmpty')}</Text>
              ) : (
                <View style={{ maxHeight: 340 }}>
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
                      <View className="flex-row items-start" style={{ gap: 8 }}>
                        {n.readAt === null && <View className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.royalBlue }} />}
                        <View className="flex-1">
                          <Text className="text-sm" style={{ fontWeight: n.readAt === null ? '700' : '400', color: n.readAt === null ? '#1B2430' : '#6E6A61' }}>
                            {n.title}
                          </Text>
                          <Text className="mt-0.5 text-xs text-[#6E6A61]">{n.body}</Text>
                          <Text className="mt-1 text-[10px] text-[#9CA3AF]">{new Date(n.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function HeaderTitle({ children }: { children: ReactNode }) {
  return <Text className="text-lg font-semibold text-white">{children}</Text>;
}
