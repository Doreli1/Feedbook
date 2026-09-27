import { useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, HeaderMenu } from '../src/components/AppHeader';
import { FeedbookWordmark } from '../src/components/FeedbookWordmark';
import { useI18n } from '../src/lib/i18n';
import type { TranslationKey } from '../src/lib/translations';
import { colors } from '../src/theme';

// "פרטי מסעדה" — App Flow §2 flow-table row 6, §2.2א. Note this is a
// *different* numbering scheme than the Milestone 4 Mobile UI Spec's own
// "M-06" (that one is the QR-scan screen, app/scan-qr.tsx) — the two source
// documents number screens independently; this file isn't "M-06" in that
// sense, just flow-table position 6. This is the "landing screen" the App
// Flow doc describes right after QR scanning (screen 5 → 6 → 7 in its flow
// table) — resolveTableToken.ts routes here first, before add-participants.
// Every field below (name/address/hours/phone) comes straight from
// scan-qr's response; nothing here needs its own network call. No mockup
// image exists for this screen in the UI mockup folder (it jumps straight
// from "5-QR scan" to "6.1-AddFriends") — the layout below is this app's
// own reasonable reading of the written spec, not a pixel target.
//
// Kosher badge terminology is locked by Content Guidelines §3's terminology
// table ("מאושרת כשרות" / "לא מאושרת כשרות" — never "כשר" alone) and the
// certificate disclaimer is the exact, non-removable wording mandated by
// Content Guidelines §7.2א — not paraphrased.
// Sunday=0 .. Saturday=6, matching apps/web/src/screens/RestaurantDetailsForm.tsx's
// own DAY_KEYS convention exactly (same hours JSON shape, same day order) —
// the day abbreviation follows the diner's chosen language, not just Hebrew.
const DAY_LABELS: Record<'he' | 'en', string[]> = {
  he: ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

interface HourRule {
  fromDay: number;
  toDay: number;
  open: string;
  close: string;
}

function parseHourRules(raw: string): HourRule[] {
  try {
    const parsed = JSON.parse(raw) as { rules?: HourRule[] } | null;
    return parsed?.rules ?? [];
  } catch {
    return [];
  }
}

function formatRuleLine(rule: HourRule, dayLabels: string[]): string {
  const days = rule.fromDay === rule.toDay ? dayLabels[rule.fromDay] : `${dayLabels[rule.fromDay]}-${dayLabels[rule.toDay]}`;
  return `${days} ${rule.open}-${rule.close}`;
}

const SATURDAY = 6;

function ruleCoversDay(rule: HourRule, day: number): boolean {
  return rule.fromDay <= rule.toDay ? day >= rule.fromDay && day <= rule.toDay : day >= rule.fromDay || day <= rule.toDay;
}

// JS Date.getDay() returns 0=Sunday..6=Saturday — the exact same convention
// this project's hours JSON already uses (see
// apps/web/src/screens/RestaurantDetailsForm.tsx's own DAY_KEYS), so no
// conversion is needed to find "today"'s rule(s).
//
// isCertified forces "closed" on Saturday regardless of what's actually
// stored in hours — a kosher-certified restaurant isn't open on Shabbat
// (Content Guidelines/Backend Schema §1.3, added 2026-09-10). This is a
// display-layer rule, not a DB constraint: nothing stops an owner from
// still entering Saturday hours, so old/incorrect data can't produce a
// wrong "open" reading for a certified restaurant here.
function getTodayHourLines(rules: HourRule[], isCertified: boolean): string[] {
  const today = new Date().getDay();
  if (isCertified && today === SATURDAY) return [];
  return rules.filter((r) => ruleCoversDay(r, today)).map((r) => `${r.open}-${r.close}`);
}

// Same Shabbat override applied to the expanded full-week view: a rule that
// only covers Saturday is dropped, and a rule whose range ends on Saturday
// is shortened to stop at Friday — then an explicit "Saturday: closed" line
// is appended so the rule is visible, not just silently missing.
function getWeekHourLines(rules: HourRule[], dayLabels: string[], isCertified: boolean, closedLabel: string): string[] {
  if (!isCertified) return rules.map((r) => formatRuleLine(r, dayLabels));
  const lines: string[] = [];
  for (const r of rules) {
    if (!ruleCoversDay(r, SATURDAY)) {
      lines.push(formatRuleLine(r, dayLabels));
    } else if (r.fromDay !== SATURDAY && r.fromDay <= r.toDay) {
      lines.push(formatRuleLine({ ...r, toDay: SATURDAY - 1 }, dayLabels));
    }
    // A rule that is Saturday-only, or wraps around through Saturday in a
    // shape not covered above, is dropped — the appended closed-line below
    // is the correct statement either way.
  }
  lines.push(`${dayLabels[SATURDAY]}: ${closedLabel}`);
  return lines;
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith('.pdf');
}

export default function RestaurantDetailsScreen() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    restaurantId: string;
    restaurantName: string;
    restaurantLogoUrl: string;
    restaurantDescription: string;
    cuisineTags: string;
    cancellationWindowMinutes: string;
    restaurantAddress: string;
    restaurantPhone: string;
    restaurantHours: string;
    kosherStatus: string;
    kosherCertificateUrl: string;
    tableId: string;
    tableNumber: string;
    sessionId: string;
    sessionAccountNumber: string;
    qrToken: string;
  }>();

  const [certificateVisible, setCertificateVisible] = useState(false);
  const [certificateZoomVisible, setCertificateZoomVisible] = useState(false);
  const [weekExpanded, setWeekExpanded] = useState(false);

  const isCertified = params.kosherStatus === 'certified';
  const hasCertificate = isCertified && !!params.kosherCertificateUrl;
  const dayLabels = DAY_LABELS[lang];
  const hourRules = parseHourRules(params.restaurantHours ?? '');
  const todayLines = getTodayHourLines(hourRules, isCertified);
  const weekLines = getWeekHourLines(hourRules, dayLabels, isCertified, t('closedLabel'));
  const cuisineTags: string[] = (() => {
    try {
      return JSON.parse(params.cuisineTags || '[]') as string[];
    } catch {
      return [];
    }
  })();
  const CUISINE_LABEL_KEYS: Record<string, TranslationKey> = {
    dairy: 'cuisineDairy',
    meat: 'cuisineMeat',
    fish: 'cuisineFish',
    asian: 'cuisineAsian',
  };

  function handleBadgePress() {
    if (hasCertificate) setCertificateVisible(true);
  }

  function handleCall() {
    if (params.restaurantPhone) void Linking.openURL(`tel:${params.restaurantPhone}`);
  }

  function handleContinue() {
    router.push({
      pathname: '/add-participants',
      params: {
        restaurantId: params.restaurantId,
        restaurantName: params.restaurantName,
        tableId: params.tableId,
        tableNumber: params.tableNumber,
        sessionId: params.sessionId,
        sessionAccountNumber: params.sessionAccountNumber,
        qrToken: params.qrToken,
      },
    });
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <AppHeader right={<FeedbookWordmark size={24} />} left={<HeaderMenu />} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="items-center px-6 pb-4 pt-6">
          <View
            className="h-32 w-32 items-center justify-center overflow-hidden rounded-full"
            style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }}
          >
            {params.restaurantLogoUrl ? (
              <Image source={{ uri: params.restaurantLogoUrl }} className="h-32 w-32" resizeMode="cover" />
            ) : (
              <Ionicons name="storefront-outline" size={44} color={colors.textMuted} />
            )}
          </View>
          <Text className="mt-3 text-center text-2xl font-bold text-[#1B2430]">{params.restaurantName}</Text>
          <Text className="mt-0.5 text-base text-[#6E6A61]">
            {t('tableLabel')} {params.tableNumber}
          </Text>
        </View>

        <Pressable
          onPress={handleBadgePress}
          className="mb-4 flex-row items-center gap-2 self-center rounded-full px-3 py-1.5"
          style={{ backgroundColor: isCertified ? colors.successSoft : colors.surface, borderWidth: 1, borderColor: isCertified ? colors.success : colors.border }}
        >
          <Ionicons name={isCertified ? 'checkmark-circle' : 'close-circle-outline'} size={16} color={isCertified ? colors.success : colors.textMuted} />
          <Text className="text-base font-semibold" style={{ color: isCertified ? colors.success : colors.textMuted }}>
            {isCertified ? t('kosherCertified') : t('kosherNotCertified')}
          </Text>
          {hasCertificate && <Ionicons name="chevron-back" size={14} color={colors.success} />}
        </Pressable>

        {cuisineTags.length > 0 && (
          <View className="mb-3 flex-row flex-wrap justify-center gap-1.5 px-6">
            {cuisineTags.map((tag) => (
              <View key={tag} className="rounded-full px-4 py-2" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <Text className="text-base font-medium text-[#1B2430]">{t(CUISINE_LABEL_KEYS[tag] ?? 'cuisineDairy')}</Text>
              </View>
            ))}
          </View>
        )}

        {!!params.restaurantDescription && (
          <Text className="mb-4 px-6 text-center text-base leading-6 text-[#6E6A61]">{params.restaurantDescription}</Text>
        )}

        <View className="mx-6 mb-3 rounded-xl bg-white p-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          {hourRules.length > 0 ? (
            <Pressable onPress={() => setWeekExpanded((v) => !v)} className="flex-row items-start gap-3 py-2">
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              <View className="flex-1">
                <Text className="text-sm text-[#9CA3AF]">{t('hoursToday')}</Text>
                <Text className="text-base text-[#1B2430]">
                  {todayLines.length > 0 ? todayLines.join(', ') : t('hoursClosedToday')}
                </Text>
                {weekExpanded && (
                  <Text className="mt-1.5 text-sm leading-6 text-[#6E6A61]">{weekLines.join(', ')}</Text>
                )}
              </View>
              <Ionicons name={weekExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
          ) : (
            <View className="flex-row items-start gap-3 py-2">
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              <Text className="flex-1 text-base text-[#6E6A61]">{t('hoursNotPublished')}</Text>
            </View>
          )}

          {!!params.restaurantAddress && (
            <View className="flex-row items-start gap-3 border-t py-2" style={{ borderColor: colors.border }}>
              <Ionicons name="location-outline" size={18} color={colors.textMuted} />
              <Text className="flex-1 text-base text-[#1B2430]">{params.restaurantAddress}</Text>
            </View>
          )}

          {!!params.restaurantPhone && (
            <Pressable onPress={handleCall} className="flex-row items-start gap-3 border-t py-2" style={{ borderColor: colors.border }}>
              <Ionicons name="call-outline" size={18} color={colors.textMuted} />
              <Text className="flex-1 text-base text-[#1B3FA8]">{params.restaurantPhone}</Text>
            </Pressable>
          )}
        </View>

        <View className="mx-6 mb-3 rounded-xl bg-white p-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <Text className="mb-2 text-base font-semibold text-[#1B2430]">{t('orderPaymentPolicyTitle')}</Text>
          <Text className="text-sm leading-6 text-[#6E6A61]">{t('paymentPolicyText')}</Text>
        </View>

        <View className="mx-6 rounded-xl bg-white p-4" style={{ borderColor: colors.border, borderWidth: 1 }}>
          <Text className="mb-2 text-base font-semibold text-[#1B2430]">{t('cancellationPolicyTitle')}</Text>
          <Text className="mb-2 text-sm leading-6 text-[#1B2430]">
            {params.cancellationWindowMinutes === ''
              ? t('cancellationWindowUnset')
              : params.cancellationWindowMinutes === '0'
                ? t('cancellationNotAllowed')
                : `${t('cancellationWindowPrefix')} ${params.cancellationWindowMinutes} ${t('cancellationWindowSuffix')}`}
          </Text>
          <Text className="text-sm leading-6 text-[#6E6A61]">{t('cancellationWindowVariesNote')}</Text>
        </View>
      </ScrollView>

      <View className="px-6 pt-3" style={{ paddingBottom: insets.bottom + 16 }}>
        <Pressable onPress={handleContinue} className="items-center rounded-xl py-4" style={{ backgroundColor: colors.royalBlue }}>
          <Text className="text-lg font-semibold text-white">{t('continueLabel')}</Text>
        </Pressable>
      </View>

      <Modal visible={certificateVisible} transparent animationType="fade" onRequestClose={() => setCertificateVisible(false)}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5">
            <Text className="mb-3 text-center text-lg font-bold text-[#1B2430]">{t('kosherCertificateTitle')}</Text>

            {params.kosherCertificateUrl && !isPdfUrl(params.kosherCertificateUrl) ? (
              <Pressable onPress={() => setCertificateZoomVisible(true)}>
                <Image
                  source={{ uri: params.kosherCertificateUrl }}
                  style={{ width: '100%', height: 260, borderRadius: 10, backgroundColor: colors.background }}
                  resizeMode="contain"
                />
                <View className="absolute inset-x-0 bottom-2 items-center">
                  <View className="flex-row items-center gap-1 rounded-full bg-black/50 px-2.5 py-1">
                    <Ionicons name="expand-outline" size={12} color="#FFFFFF" />
                    <Text className="text-xs text-white">{t('tapToEnlarge')}</Text>
                  </View>
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => params.kosherCertificateUrl && void Linking.openURL(params.kosherCertificateUrl)}
                className="items-center rounded-lg py-3"
                style={{ backgroundColor: colors.background }}
              >
                <Text className="text-base font-semibold text-[#1B3FA8]">{t('openCertificatePdf')}</Text>
              </Pressable>
            )}

            <Text className="mt-4 text-center text-sm leading-6 text-[#6E6A61]">{t('kosherDisclaimer')}</Text>

            <Pressable onPress={() => setCertificateVisible(false)} className="mt-4 items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="text-base font-semibold text-white">{t('closeMenu')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={certificateZoomVisible} animationType="fade" onRequestClose={() => setCertificateZoomVisible(false)}>
        <View className="flex-1 items-center justify-center bg-black">
          {params.kosherCertificateUrl && (
            <Image
              source={{ uri: params.kosherCertificateUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          )}
          <Pressable
            onPress={() => setCertificateZoomVisible(false)}
            className="absolute items-center justify-center rounded-full bg-black/50"
            style={{ top: insets.top + 12, end: 16, height: 40, width: 40 }}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
