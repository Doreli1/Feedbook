import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { Dish, DishModifierGroup, DishModifierOption, DishSizeOption, MenuCategory } from '@feedbook/types';
import { ErrorModal } from '../ErrorModal';
import { useI18n } from '../../lib/i18n';
import type { TranslationKey } from '../../lib/translations';
import { supabase } from '../../lib/supabase';
import { extractFunctionErrorCode } from '../../lib/functionError';
import { cartTotal, useCartStore } from '../../lib/cartStore';
import { useTableSessionStore } from '../../lib/tableSessionStore';
import { colors } from '../../theme';

type MenuSection = 'food' | 'drink';

// Mockup 7.1-Meals menus.JPG's top-level split — menu_categories.section
// (20260914092000). Everything below is grouped once by this, then by
// menu_categories.sort_order within each section.
interface MenuData {
  categories: MenuCategory[];
  dishesByCategory: Map<string, Dish[]>;
  sizesByDish: Map<string, DishSizeOption[]>;
  groupsByDish: Map<string, DishModifierGroup[]>;
  optionsByGroup: Map<string, DishModifierOption[]>;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

// Live menu updates (2026-09-24) — every admin save (a dish's price, its
// serving sizes, an add-on's single/multiple mode, a whole new dish) used to
// only ever reach a diner's screen on their next screen remount, since this
// hook only ever fetched once. Found while adding this: menu_categories,
// dishes, dish_size_options, dish_modifier_groups and dish_modifier_options
// had never actually been added to the supabase_realtime publication either
// (20260924140000) — the exact same "subscription looks wired up but is
// silently inert" gap already diagnosed once this session for notifications
// (20260919160000_realtime_publication_tables.sql). Same
// unfiltered-subscribe-then-refetch shape as useDishOrderStats below and
// Dashboard.tsx's own kitchen channel — RLS still correctly scopes what the
// refetch itself can see; the subscription is just the "something changed,
// go look again" signal.
function useMenuData(restaurantId: string | null) {
  const [data, setData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    const rid = restaurantId;
    let cancelled = false;

    async function refresh() {
      const [{ data: categories }, { data: dishes }] = await Promise.all([
        supabase.from('menu_categories').select('*').eq('restaurant_id', rid).order('section').order('sort_order'),
        supabase.from('dishes').select('*').eq('restaurant_id', rid).eq('is_available', true).order('name'),
      ]);
      const dishIds = (dishes ?? []).map((d) => d.id);
      const [{ data: sizes }, { data: groups }] = await Promise.all([
        dishIds.length
          ? supabase.from('dish_size_options').select('*').in('dish_id', dishIds).order('sort_order')
          : Promise.resolve({ data: [] as DishSizeOption[] }),
        dishIds.length
          ? supabase.from('dish_modifier_groups').select('*').in('dish_id', dishIds).order('sort_order')
          : Promise.resolve({ data: [] as DishModifierGroup[] }),
      ]);
      const groupIds = (groups ?? []).map((g) => g.id);
      const { data: options } = groupIds.length
        ? await supabase.from('dish_modifier_options').select('*').in('group_id', groupIds).order('sort_order')
        : { data: [] as DishModifierOption[] };

      if (cancelled) return;
      setData({
        categories: categories ?? [],
        dishesByCategory: groupBy(dishes ?? [], (d) => d.category_id),
        sizesByDish: groupBy(sizes ?? [], (s) => s.dish_id),
        groupsByDish: groupBy(groups ?? [], (g) => g.dish_id),
        optionsByGroup: groupBy(options ?? [], (o) => o.group_id),
      });
      setLoading(false);
    }

    setLoading(true);
    void refresh();
    const channel = supabase
      .channel(`menu-data-${rid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_categories' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dish_size_options' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dish_modifier_groups' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dish_modifier_options' }, () => void refresh())
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  return { data, loading };
}

export interface DishOrderStats {
  count: number;
  lastOrderedAt: string;
}

// Real, live order activity per dish (2026-09-24) — never a fixed/fabricated
// urgency claim, per the legal-risk discussion that prompted this feature:
// only ever shows a bullet when get_dish_order_stats() actually returns a
// row for that dish today. The RPC exists because a diner's own client
// cannot otherwise see any order but their own (order_items RLS) — see the
// migration for the full reasoning. Refetches on any order_items change for
// the restaurant, same unfiltered-subscribe-then-refetch shape already used
// by apps/web/src/screens/Dashboard.tsx's own kitchen channel (RLS still
// correctly narrows what a given caller's refetch can actually see).
function useDishOrderStats(restaurantId: string | null) {
  const [stats, setStats] = useState<Map<string, DishOrderStats>>(new Map());

  useEffect(() => {
    if (!restaurantId) return;
    const rid = restaurantId;
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.rpc('get_dish_order_stats', { p_restaurant_id: rid });
      if (cancelled) return;
      setStats(
        new Map(
          (data ?? [])
            .filter((row): row is typeof row & { last_ordered_at: string } => row.last_ordered_at !== null)
            .map((row) => [row.dish_id, { count: row.orders_today, lastOrderedAt: row.last_ordered_at }]),
        ),
      );
    }

    void refresh();
    const channel = supabase
      .channel(`dish-order-stats-${rid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => void refresh())
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  return stats;
}

// Shared broadcast subscription for the three ingredient-derived hooks below
// (2026-09-27) — replaces separate postgres_changes listeners on
// ingredients/dish_ingredients/modifier_option_ingredients. Root cause found
// via a live test: Realtime filters postgres_changes delivery through the
// SUBSCRIBER's own RLS on the changed table, and all three of those tables
// are staff-only (no diner SELECT policy, by design — exact stock, SKUs and
// supplier info are private operational data) — so a diner's client could
// never receive an event there no matter how healthy the replication
// connection was (confirmed: the identical subscription on the *publicly*
// readable `dishes` table delivered instantly). A DB trigger
// (notify_restaurant_inventory_change, 20260927090000) now broadcasts an
// empty ping to `restaurant_inventory:<restaurant_id>` on any change to
// those three tables — broadcast is a plain message, not a row-level
// replication event, so it's entirely unaffected by the source tables' RLS.
function useRestaurantInventoryBroadcast(restaurantId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!restaurantId) return;
    const rid = restaurantId;
    const channel = supabase
      .channel(`restaurant_inventory:${rid}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => onChange())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);
}

// Which of a dish's marked-critical ingredients (Web Admin's own "קריטי"
// toggle in MenuManager.tsx's ingredient tags) are currently low or fully
// out — same "real data only" rule and same RLS reasoning as
// useDishOrderStats above, just for ingredients/dish_ingredients instead of
// orders/order_items.
function useDishCriticalStock(restaurantId: string | null) {
  const [status, setStatus] = useState<Map<string, 'low' | 'out'>>(new Map());

  useEffect(() => {
    if (!restaurantId) return;
    const rid = restaurantId;
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.rpc('get_dish_critical_stock_status', { p_restaurant_id: rid });
      if (cancelled) return;
      setStatus(new Map((data ?? []).map((row) => [row.dish_id, row.status as 'low' | 'out'])));
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  useRestaurantInventoryBroadcast(restaurantId, () => {
    if (!restaurantId) return;
    void supabase.rpc('get_dish_critical_stock_status', { p_restaurant_id: restaurantId }).then(({ data }) => {
      setStatus(new Map((data ?? []).map((row) => [row.dish_id, row.status as 'low' | 'out'])));
    });
  });

  return status;
}

// Non-critical ingredients gone out of stock (2026-09-24) — the soft
// counterpart to useDishCriticalStock above: a NON-critical ingredient
// running out never blocks the dish, it just names the specific ingredient
// so the diner knows it won't be included (per the user's own example: no
// lemon/tomato shouldn't stop them ordering, just tell them). Surfaced only
// inside DishDetailModal, not the list row, per the user's explicit choice.
function useDishMissingIngredients(restaurantId: string | null) {
  const [missing, setMissing] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!restaurantId) return;
    const rid = restaurantId;
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.rpc('get_dish_missing_ingredients', { p_restaurant_id: rid });
      if (cancelled) return;
      const map = new Map<string, string[]>();
      for (const row of data ?? []) {
        map.set(row.dish_id, [...(map.get(row.dish_id) ?? []), row.ingredient_name]);
      }
      setMissing(map);
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  useRestaurantInventoryBroadcast(restaurantId, () => {
    if (!restaurantId) return;
    void supabase.rpc('get_dish_missing_ingredients', { p_restaurant_id: restaurantId }).then(({ data }) => {
      const map = new Map<string, string[]>();
      for (const row of data ?? []) {
        map.set(row.dish_id, [...(map.get(row.dish_id) ?? []), row.ingredient_name]);
      }
      setMissing(map);
    });
  });

  return missing;
}

// Addon/modifier-option-level shortage (2026-09-24) — found via a real
// device test: "אורז לבן" is offered as an addon OPTION (תוספות למנה), not a
// dish_ingredients row, so neither useDishCriticalStock nor
// useDishMissingIngredients above ever saw it running out — that ingredient
// link lives in the separate modifier_option_ingredients table entirely.
// Per the user's explicit choice: unlike a missing base ingredient, an
// out-of-stock addon OPTION doesn't need a critical/non-critical split or a
// dish-level note — it just disables that one option in its own picker, so
// the diner picks a different option in the same group instead.
function useUnavailableModifierOptions(restaurantId: string | null) {
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!restaurantId) return;
    const rid = restaurantId;
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.rpc('get_unavailable_modifier_options', { p_restaurant_id: rid });
      if (cancelled) return;
      setUnavailable(new Set((data ?? []).map((row) => row.option_id)));
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  useRestaurantInventoryBroadcast(restaurantId, () => {
    if (!restaurantId) return;
    void supabase.rpc('get_unavailable_modifier_options', { p_restaurant_id: restaurantId }).then(({ data }) => {
      setUnavailable(new Set((data ?? []).map((row) => row.option_id)));
    });
  });

  return unavailable;
}

export interface DishSampleReview {
  id: string;
  nickname: string | null;
  comment: string;
  photoUrl: string | null;
  ageRange: string | null;
}

// Verified-diner reviews for a dish (2026-09-24) — real data only, per the
// user's explicit correction: these aren't a best-effort guess, they're the
// platform's actual review system (a diner fills one out after closing their
// bill; reviews.status only ever reaches 'published' through Feedbook's own
// moderation — public_read_published_reviews/
// public_read_published_review_dish_ratings, 20260830145852). Those two
// tables plus reviews.nickname_display/liked_text are already safely
// client-readable under that RLS. Only the reviewer's photo/age needed a new
// RPC (get_reviewer_public_info, 20260924170000) — user_profiles is
// owner-only, and even then it returns a 5-year age bucket, never the raw
// birthdate. positiveReviewCount powers "X guests had a great experience";
// reviews is a short sample of ones that actually left a comment
// (liked_text), highest-rated first — fetched once per dish, not
// realtime-subscribed (reviews arrive far less often than menu/stock
// changes, and only after a full moderation cycle).
function useDishReviews(dishId: string) {
  const [reviews, setReviews] = useState<DishSampleReview[]>([]);
  const [positiveReviewCount, setPositiveReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from('review_dish_ratings')
        .select('*', { count: 'exact', head: true })
        .eq('dish_id', dishId)
        .gte('rating', 4);
      if (!cancelled) setPositiveReviewCount(count ?? 0);

      const { data } = await supabase
        .from('review_dish_ratings')
        .select('rating, reviews(id, nickname_display, liked_text, user_id)')
        .eq('dish_id', dishId)
        .gte('rating', 4)
        .order('rating', { ascending: false })
        .limit(10);

      const withText = (data ?? [])
        .map((row) => row.reviews)
        .filter((r): r is NonNullable<typeof r> => r !== null && !!r.liked_text?.trim())
        .slice(0, 3);

      const userIds = [...new Set(withText.map((r) => r.user_id).filter((id): id is string => id !== null))];
      const infoMap = new Map<string, { photoUrl: string | null; ageRange: string | null }>();
      if (userIds.length > 0) {
        const { data: info } = await supabase.rpc('get_reviewer_public_info', { p_user_ids: userIds });
        for (const row of info ?? []) infoMap.set(row.user_id, { photoUrl: row.photo_url, ageRange: row.age_range });
      }

      if (cancelled) return;
      setReviews(
        withText.map((r) => ({
          id: r.id,
          nickname: r.nickname_display,
          comment: r.liked_text!.trim(),
          photoUrl: r.user_id ? (infoMap.get(r.user_id)?.photoUrl ?? null) : null,
          ageRange: r.user_id ? (infoMap.get(r.user_id)?.ageRange ?? null) : null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [dishId]);

  return { reviews, positiveReviewCount };
}

// "no data yet" -> null (hides the bullet entirely). The "last ordered X ago"
// parenthetical only ever shows for a real window — 1 minute to 3 hours
// (2026-09-27, per explicit request) — anything outside that (under a
// minute, or over 3 hours) falls back to just today's count.
function orderActivityLabel(stats: DishOrderStats | undefined, t: (key: TranslationKey) => string): string | null {
  if (!stats || stats.count === 0) return null;
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(stats.lastOrderedAt).getTime()) / 60000));
  const countOnly = t('dishOrdersTodayLabel').replace('{count}', String(stats.count));
  if (minutesAgo < 1 || minutesAgo > 180) return countOnly;
  const timeLabel = minutesAgo > 60 ? t('dishHoursAgo').replace('{hours}', String(Math.round(minutesAgo / 60))) : t('dishMinutesAgo').replace('{minutes}', String(minutesAgo));
  return t('dishOrdersTodayWithLastLabel').replace('{count}', String(stats.count)).replace('{time}', timeLabel);
}

// Full stars only (2026-09-27, per explicit request) — a 3.7/5 rating shows
// exactly 4 filled stars, not 4 filled + 1 outline. No empty/outline icons
// at all, regardless of how far below 5 the rounded value lands.
export function StarRow({ value, size = 12 }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return (
    <View className="flex-row" style={{ gap: 1 }}>
      {Array.from({ length: rounded }, (_, i) => (
        <Ionicons key={i} name="star" size={size} color="#F5A623" />
      ))}
    </View>
  );
}

// Booking-style 0–10 guest-rating tier label, mirroring the mockup's
// "עולה"/"מעולה"-type qualifier under the numeric badge (7.1.1-Meats
// menus.JPG). Only shown once rating_count > 0, same as the badge itself.
function ratingTierLabel(score: number, t: (key: TranslationKey) => string): TranslationKey {
  if (score >= 9) return 'ratingTierExceptional';
  if (score >= 8) return 'ratingTierExcellent';
  if (score >= 7) return 'ratingTierVeryGood';
  if (score >= 6) return 'ratingTierGood';
  return 'ratingTierFair';
}

// "החל מ-" only means something once the sizes actually span 2+ distinct
// PRICES (2026-09-29, refined per explicit follow-up) — two serving sizes
// that happen to cost the same are still just one real price to the diner.
// Checked by distinct price value, not option count, and independent of
// sort order (Math.min already doesn't care which one comes first).
function priceLabel(dish: Dish, sizes: DishSizeOption[], t: (key: TranslationKey) => string): string {
  const distinctPrices = new Set(sizes.map((s) => s.price));
  if (distinctPrices.size <= 1) {
    const price = sizes.length > 0 ? sizes[0]!.price : dish.price;
    return `${t('dishPriceLabel')} ₪${price}`;
  }
  const min = Math.min(...sizes.map((s) => s.price));
  return `${t('dishPriceFrom')} ₪${min}`;
}

// Discounted-price treatment: original price crossed out, discounted price
// next to it, percentage as a small amber tag (#FEF3C7/#B45309) — not
// colors.danger, which theme.ts explicitly reserves for sign-out/destructive
// actions only. RTL row: original price comes first in source order so it
// lands on the physical right (read first), discounted price and the
// percentage tag follow to its left.
function PriceRow({ dish, sizes, t }: { dish: Dish; sizes: DishSizeOption[]; t: (key: TranslationKey) => string }) {
  if (dish.discount_percent <= 0) {
    return (
      <Text className="text-sm font-semibold" style={{ color: colors.royalBlue }}>
        {priceLabel(dish, sizes, t)}
      </Text>
    );
  }
  // "From" only once sizes span 2+ distinct prices (2026-09-29) — same rule
  // as priceLabel above, not just 2+ options.
  const hasMultiplePrices = new Set(sizes.map((s) => s.price)).size > 1;
  const basePrice = sizes.length >= 1 ? Math.min(...sizes.map((s) => s.price)) : dish.price;
  const prefix = hasMultiplePrices ? `${t('dishPriceFrom')} ` : '';
  const discounted = Math.round(basePrice * (1 - dish.discount_percent / 100) * 100) / 100;
  return (
    <View className="flex-row items-center" style={{ gap: 5 }}>
      <Text className="text-xs" style={{ color: '#9CA3AF', textDecorationLine: 'line-through' }}>
        {prefix}₪{basePrice}
      </Text>
      <Text className="text-sm font-semibold" style={{ color: colors.royalBlue }}>
        ₪{discounted}
      </Text>
      <View className="rounded px-1 py-0.5" style={{ backgroundColor: '#FEF3C7' }}>
        <Text className="text-[10px] font-bold" style={{ color: '#B45309' }}>
          -{dish.discount_percent}%
        </Text>
      </View>
    </View>
  );
}

// Mockup 7.1.1-Meats menus.JPG: a white rounded pill (count + heart) sits
// directly on top of the photo's corner. 2026-09-14 (real-device feedback,
// round 1): made a real toggle-like button, not a static count.
//
// 2026-09-14 (round 2): this button lives on a CATEGORY card, not a dish
// card — a diner tapping it means "I like this category," not "I like
// whichever dish happened to be picked as the card's photo." Originally
// wired to dish_likes on that hero dish specifically, which conflated the
// two. Rebuilt against a dedicated menu_category_likes table (20260914120000,
// same shape/RLS pattern as dish_likes, kept genuinely separate rather than
// overloading it) — this component now targets whichever table/id pair is
// passed in, so the same component still serves a future dish-level like
// button too without duplicating the toggle logic.
function LikeButton({
  table,
  id,
  initialCount,
}: {
  table: 'dish_likes' | 'menu_category_likes';
  id: string | undefined;
  initialCount: number;
}) {
  // Supabase's generated query builder types .eq()'s column argument per
  // table — since `table` here is a runtime union, TS can't narrow which
  // table's column set applies. `never` is the one type assignable to any
  // parameter type, so this cast is a deliberate, narrow escape hatch (not
  // a stand-in for real typing elsewhere) — the runtime value is always
  // exactly the correct column name for whichever table was actually passed.
  const idColumn = (table === 'dish_likes' ? 'dish_id' : 'category_id') as never;
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase.from(table).select(idColumn).eq(idColumn, id).eq('user_id', user.id).maybeSingle();
      if (!cancelled && data) setLiked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [table, idColumn, id]);

  async function toggle() {
    if (!id || busy) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    if (liked) {
      setLiked(false);
      setCount((c) => Math.max(0, c - 1));
      const { error } = await supabase.from(table).delete().eq(idColumn, id).eq('user_id', user.id);
      if (error) {
        setLiked(true);
        setCount((c) => c + 1);
      }
    } else {
      setLiked(true);
      setCount((c) => c + 1);
      const { error } = await supabase.from(table).insert({ [idColumn]: id, user_id: user.id } as never);
      if (error) {
        setLiked(false);
        setCount((c) => Math.max(0, c - 1));
      }
    }
    setBusy(false);
  }

  return (
    <Pressable
      onPress={() => void toggle()}
      disabled={!id || busy}
      hitSlop={8}
      className="flex-row items-center rounded-full bg-white px-2.5 py-1.5"
      style={{
        // 2026-09-14 (correction): this app already has an established,
        // real-device-verified rule (BurgerSideMenu.tsx's own X-badge fix,
        // 2026-09-11) that under this app's forced RTL, React Native
        // mirrors absolute left/right the same way it mirrors flex-row —
        // style `left` actually renders on the physical RIGHT, not the
        // left. The previous version of this button used `left: 8`
        // expecting it to stay physically left, which is exactly backwards
        // per that rule — confirmed by real-device feedback showing it on
        // the right. `right: 8` is what actually lands on the physical left
        // in Hebrew, and correctly flips to the physical right once English
        // switches this app to LTR (no mirroring applies there) — matching
        // both "left in Hebrew" and "should flip with the language" in one
        // property, with no isRTL branch needed.
        position: 'absolute',
        top: 8,
        right: 8,
        gap: 5,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
      }}
    >
      <Text className="text-sm font-semibold text-[#1B2430]">{count}</Text>
      <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? '#DC2626' : '#1B2430'} />
    </Pressable>
  );
}

function CategoryCard({
  category,
  dishes,
  onPress,
  t,
  isRTL,
}: {
  category: MenuCategory;
  dishes: Dish[];
  onPress: () => void;
  t: (key: TranslationKey) => string;
  isRTL: boolean;
}) {
  const rated = dishes.filter((d) => d.rating_count > 0);
  const avgRating = rated.length > 0 ? rated.reduce((sum, d) => sum + (d.rating_avg ?? 0), 0) / rated.length : null;
  const totalReviews = dishes.reduce((sum, d) => sum + d.rating_count, 0);
  const heroDish = dishes[0];

  return (
    <Pressable
      onPress={onPress}
      className="mb-4 overflow-hidden rounded-xl bg-white"
      style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
    >
      {/* Full-width 16:9 hero image, edge-to-edge — the previous fixed
          160x160 square left a large empty gap on one side of every card
          inside a full-width layout, which is exactly the "not symmetric"
          mismatch against 7.1/7.2's edge-to-edge photo. */}
      <View style={{ width: '100%', aspectRatio: 16 / 9 }}>
        {heroDish?.photo_urls[0] ? (
          <Image source={{ uri: heroDish.photo_urls[0] }} style={{ width: '100%', height: '100%' }} />
        ) : (
          <View style={{ width: '100%', height: '100%', backgroundColor: '#EFEBE2' }} />
        )}
        <LikeButton table="menu_category_likes" id={category.id} initialCount={category.likes_count} />
      </View>
      {/* pt-2 (not py-3) so the name sits close under the image, per
          feedback that it read as floating too far below it. Rating block
          moved beside the name (not a separate row above it) — right side
          (RTL-start) holds the name, left side holds stars + verified-
          review count, both at the top of the strip. paddingEnd (not a
          symmetric px-3) so this block sits closer to the card's actual
          left edge in Hebrew, per feedback that it read as floating too far
          from it — paddingStart keeps the name's own breathing room. */}
      <View className="pb-3 pt-2" style={{ paddingStart: 12, paddingEnd: 6 }}>
        <View className="flex-row items-start justify-between">
          <Text className="flex-1 text-base font-bold" style={{ color: '#173A63' }}>
            {category.name}
          </Text>
          {avgRating !== null && (
            <View className="flex-row items-center" style={{ gap: 4, marginStart: 6 }}>
              <Ionicons name="trophy" size={13} color="#F5A623" />
              <StarRow value={avgRating} size={15} />
            </View>
          )}
        </View>
        {/* Review count moved down onto the same row as "ראו את כל התפריט"
            (was on the stars' row above) — same text-xs size as that link,
            opposite side of the same row via justify-between. */}
        <View className="mt-1.5 flex-row items-center justify-between">
          {/* The chevron is rendered as a nested <Text> using Ionicons' own
              glyph character (its "ionicons" icon font), not a separate
              <Ionicons> element beside this one — a sibling icon component
              is measured and centered as its own box, which is exactly why
              the previous flexbox/marginTop attempts kept drifting: gap and
              vertical centering are being eyeballed against a box that
              isn't the visible glyph. Embedding the glyph inside the SAME
              Text node makes it one text run, so it sits on the identical
              baseline as the label by construction, and the space before it
              gets the exact same letter-spacing as any other character in
              the string — both "always" true, not tuned per instance. */}
          <Text style={{ color: colors.royalBlue, fontSize: 13, fontWeight: '500' }}>
            {t('menuSeeAllInCategory')}{' '}
            <Text style={{ fontFamily: 'ionicons', fontSize: 14 }}>
              {String.fromCodePoint(Ionicons.glyphMap[isRTL ? 'chevron-back' : 'chevron-forward'] as number)}
            </Text>
          </Text>
          {avgRating !== null && (
            <Text className="text-xs font-medium" style={{ color: '#6E6A61' }}>
              {totalReviews} {t('categoryReviewsLabel')}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function DishRow({
  dish,
  sizes,
  onPress,
  t,
  orderStats,
  categoryOrdersToday,
  criticalStockStatus,
}: {
  dish: Dish;
  sizes: DishSizeOption[];
  onPress: () => void;
  t: (key: TranslationKey) => string;
  orderStats: DishOrderStats | undefined;
  categoryOrdersToday: number;
  criticalStockStatus: 'low' | 'out' | undefined;
}) {
  const image = dish.photo_urls[0];
  // Score-derived (2026-09-24): dishes.is_special_value turned out to be a
  // dead column (documented as "staff-set", but grepping MenuManager.tsx
  // shows no admin UI ever sets it) — per the user's instruction this badge
  // (and the trophy added earlier) now share the same real, live signal.
  const isTopRated = (dish.guest_rating_score ?? 0) > 9;
  const isHighDemand = categoryOrdersToday > 0 && (orderStats?.count ?? 0) / categoryOrdersToday >= 0.25;
  const isLowStock = criticalStockStatus === 'low';
  const isSoldOut = criticalStockStatus === 'out';
  const activityLabel = orderActivityLabel(orderStats, t);

  return (
    // Image first, content second: under this app's forced RTL, the first
    // flex-row child renders on the physical right (same convention already
    // proven in add-participants.tsx's contact rows — avatar first, name
    // second) — matching 7.1.1's layout (photo on the right, details on the
    // left), the reverse of what this row had before.
    <Pressable onPress={onPress} className="flex-row bg-white p-3" style={{ gap: 10, borderBottomWidth: 1, borderColor: colors.border }}>
      {image ? (
        <Image source={{ uri: image }} style={{ width: 120, alignSelf: 'stretch', borderRadius: 10 }} resizeMode="cover" />
      ) : (
        <View style={{ width: 120, alignSelf: 'stretch', borderRadius: 10, backgroundColor: '#EFEBE2' }} />
      )}
      <View className="flex-1 justify-center">
        {/* Title row (2026-09-24): the score badge moved up here, to the
            far corner opposite the name — same justify-between pattern
            CategoryCard's own title row already uses for its trophy+stars
            corner element, just with the score badge as the corner element
            here instead. */}
        {/* Corner score badge switched to absolute positioning (2026-09-27)
            — it used to be a flex-row sibling of the title, sharing the
            row's height with it, which was fine while it was a compact
            2-line box. Adding the review-count line made it 3 lines tall,
            taller than a 1-line title, which stretched the whole row and
            broke the stars/Feedstars row's fixed -4 pull-up below (tuned for
            the old shorter corner). Absolute positioning removes the corner
            from layout flow entirely, so the title's own height is the only
            thing the stars row needs to sit tight against, regardless of how
            tall the corner decoration gets. `end: 0` is RN's own logical
            position property — physically the left edge under this app's
            forced RTL, same corner the flex-row version sat in. */}
        <View style={{ position: 'relative' }}>
          <Text className="text-base font-semibold text-[#1B2430]" style={{ paddingEnd: 56 }} numberOfLines={2}>
            {dish.name}
          </Text>
          {dish.rating_count > 0 && (
            <View className="items-center" style={{ position: 'absolute', top: 0, end: 0 }}>
              <View className="items-center rounded px-1.5 py-0.5" style={{ backgroundColor: colors.royalBlue }}>
                <Text className="text-xs font-bold text-white">{(dish.guest_rating_score ?? 0).toFixed(1)}</Text>
                <Text className="text-[8px] font-medium text-white">{t(ratingTierLabel(dish.guest_rating_score ?? 0, t))}</Text>
              </View>
              {/* Review count below the score (2026-09-27, per explicit
                  request) — real dish.rating_count, same field the score
                  itself is derived from. Sized up slightly per follow-up
                  request. */}
              <Text className="mt-0.5 text-[9px]" style={{ color: colors.textMuted }}>
                {t('dishReviewCountLabel').replace('{count}', String(dish.rating_count))}
              </Text>
            </View>
          )}
        </View>
        {/* Stars + trophy + Feedstars, tight under the title (2026-09-27) —
            now that the corner score badge is absolutely positioned (out of
            flow), this row's gap depends only on the title text's own
            height, so a small fixed margin is stable regardless of how tall
            the corner decoration is. Feedstars sits beside the stars, not on
            its own row. flex-wrap as a safety net only; at normal card
            widths this still fits on one line. */}
        {(dish.rating_count > 0 || dish.feedstars_eligible) && (
          <View className="flex-row flex-wrap items-center" style={{ gap: 4, marginTop: 2 }}>
            {dish.rating_count > 0 && <StarRow value={dish.rating_avg ?? 0} />}
            {dish.rating_count > 0 && isTopRated && <Ionicons name="trophy" size={13} color="#F5A623" />}
            {dish.feedstars_eligible && (
              // Same "Genius"-style badge as the Web Admin's dish list (gold
              // background, white Baloo 2 wordmark, sparkles-outline icon).
              // Sized down slightly (2026-09-24): this row's height is set by
              // this badge (the tallest child), so trimming its own padding
              // is what actually pulls the whole row — and the title gap
              // above it — tighter, not the row's own marginTop/gap.
              <View className="flex-row items-center rounded" style={{ backgroundColor: '#F5A623', gap: 2, paddingHorizontal: 5.5, paddingVertical: 1.5 }}>
                <Ionicons name="sparkles-outline" size={8.5} color="#FFFFFF" />
                <Text style={{ fontFamily: 'Baloo2_700Bold', fontSize: 8.5, color: '#FFFFFF' }}>{t('dishFeedstarsBadge')}</Text>
              </View>
            )}
          </View>
        )}
        {/* Serving-size options (2026-09-24), per the mockup: only renders
            when the restaurant actually defined size options for this dish
            (`sizes` comes straight from dish_size_options — nothing shown
            for a dish with a single flat price). Each option's own `name`
            already carries its unit (e.g. "350 גרם"), so this just joins
            them with the mockup's "/" separator. */}
        {sizes.length > 0 && (
          <Text className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
            {sizes.map((s) => s.name).join(' / ')}
          </Text>
        )}
        {/* Real, live order-activity line (2026-09-24) — only ever renders
            when get_dish_order_stats() actually returned data for today;
            never a fixed/fabricated urgency claim (see the migration's own
            comment for why this had to be an RPC in the first place). */}
        {activityLabel && (
          <Text className="mt-1 text-[12px] font-medium" style={{ color: colors.bottleGreen }}>
            {activityLabel}
          </Text>
        )}
        {/* High demand (≥25% of the category's orders today) — real-data
            bullet, independently gated on its own live condition. "כמעט
            אזל" moved down next to the price (2026-09-27, per explicit
            request), no longer sharing this row. */}
        {isHighDemand && (
          <View className="mt-1 flex-row flex-wrap items-center" style={{ gap: 4 }}>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.darkRed }}>
              <Text className="text-[10px] font-semibold text-white">{t('dishHighDemandBadge')}</Text>
            </View>
          </View>
        )}
        {/* Top-rated value badge — always its own row below "ביקוש גבוה"
            (2026-09-27, per explicit request), not sharing a row/wrap with
            it. */}
        {isTopRated && (
          <View className="mt-1 flex-row items-center" style={{ gap: 4 }}>
            <View className="rounded px-2 py-0.5" style={{ borderWidth: 1.5, borderColor: colors.valueOrange, backgroundColor: '#FFFFFF' }}>
              <Text className="text-[10px] font-semibold" style={{ color: colors.valueOrange }}>
                {t('dishBadgeSpecialValue')}
              </Text>
            </View>
          </View>
        )}
        {/* alignItems: 'flex-end' — under this app's real I18nManager RTL
            (not a CSS `dir`), flex-end on the cross axis is the physical
            left, the same way a flex-row's child order already flips
            physically elsewhere in this file. */}
        <View className="mt-1.5 flex-row items-center" style={{ alignSelf: 'flex-end', gap: 6 }}>
          {/* "כמעט אזל" sits beside the price, physical right of it — first
              in source order so RTL's flip puts it there (2026-09-27, per
              explicit request, moved down from the badges row above). No
              filled background this time, just the dark-red text itself. */}
          {!isSoldOut && isLowStock && (
            <Text className="text-[10px] font-semibold" style={{ color: colors.brightRed }}>
              {t('dishAlmostOutBadge')}
            </Text>
          )}
          {isSoldOut ? (
            <Text className="text-sm font-semibold" style={{ color: '#9CA3AF', textDecorationLine: 'line-through' }}>
              {priceLabel(dish, sizes, t)}
            </Text>
          ) : (
            <PriceRow dish={dish} sizes={sizes} t={t} />
          )}
          {isSoldOut && (
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.darkRed }}>
              <Text className="text-[10px] font-semibold text-white">{t('dishUnavailableBadge')}</Text>
            </View>
          )}
        </View>
        {/* Rectangular "הזמינו" CTA (was a small round "+") with the price
            row directly above it, matching the mockup's own button — and
            royalBlue, not the list row's old one-off teal, matching the
            same primary-action color DishDetailModal's own add-to-order
            button already uses. Disabled/gray + "אזל" once the dish's
            critical ingredient is fully out. */}
        <Pressable
          onPress={isSoldOut ? undefined : onPress}
          disabled={isSoldOut}
          className="mt-1.5 items-center justify-center rounded-lg"
          style={{ backgroundColor: isSoldOut ? '#9CA3AF' : colors.royalBlue, paddingVertical: 8 }}
        >
          <Text className="text-sm font-semibold text-white">{isSoldOut ? t('dishSoldOutButton') : t('dishOrderNowButton')}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// Fixed group names the Web Admin always saves these two under (mirrors
// ADDON_GROUP_NAME/DONENESS_GROUP_NAME in apps/web/src/components/
// MenuManager.tsx — there's no dedicated "kind" column on dish_modifier_
// groups, so both sides key off the same literal names).
const ADDON_GROUP_NAME = 'תוספות למנה';
const DONENESS_GROUP_NAME = 'מידת עשייה';

// Every option tile in a group's carousel gets this same fixed width
// (2026-09-24) — found via a real device test: a long name like "תפוח אדמה
// אפוי" made its own tile visibly wider than its siblings when width was
// left to size itself off the text. Text wraps within it (numberOfLines={2})
// instead of stretching the tile.
const OPTION_TILE_WIDTH = 76;

function DishDetailModal({
  dish,
  sizes,
  groups,
  optionsByGroup,
  soldOut,
  missingIngredientNames,
  unavailableOptionIds,
  onClose,
  onAdded,
}: {
  dish: Dish;
  sizes: DishSizeOption[];
  groups: DishModifierGroup[];
  optionsByGroup: Map<string, DishModifierOption[]>;
  soldOut: boolean;
  missingIngredientNames: string[];
  unavailableOptionIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const addItem = useCartStore((s) => s.addItem);
  // No pre-selected size, ever (2026-09-24, per the user's explicit
  // request) — every size is presented neutrally and the diner must
  // actively pick one; handleAdd() below blocks adding to the order until
  // they do, the same way a required modifier group already does.
  const [sizeOptionId, setSizeOptionId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Map<string, Set<string>>>(new Map());
  const [quantity, setQuantity] = useState(1);
  const [validationErrorKey, setValidationErrorKey] = useState<TranslationKey | null>(null);
  // Same score-derived signal as DishRow's own trophy/badge (2026-09-24).
  const isTopRated = (dish.guest_rating_score ?? 0) > 9;
  const { reviews: dishReviews, positiveReviewCount } = useDishReviews(dish.id);

  function toggleOption(group: DishModifierGroup, optionId: string) {
    if (unavailableOptionIds.has(optionId)) return;
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(group.id) ?? []);
      if (group.selection_type === 'single') {
        next.set(group.id, new Set([optionId]));
      } else if (current.has(optionId)) {
        current.delete(optionId);
        next.set(group.id, current);
      } else {
        current.add(optionId);
        next.set(group.id, current);
      }
      return next;
    });
  }

  const unitPrice = useMemo(() => {
    const base = sizeOptionId ? (sizes.find((s) => s.id === sizeOptionId)?.price ?? dish.price) : dish.price;
    let modifiersTotal = 0;
    for (const group of groups) {
      const selected = selections.get(group.id) ?? new Set();
      for (const optionId of selected) {
        const option = (optionsByGroup.get(group.id) ?? []).find((o) => o.id === optionId);
        if (option) modifiersTotal += option.price_delta;
      }
    }
    return base + modifiersTotal;
  }, [sizeOptionId, selections, groups, optionsByGroup, sizes, dish.price]);

  // Order button disabled up front (2026-09-24, per the user's explicit
  // request) rather than only validating on press — a diner sees at a
  // glance that a required choice is still missing, instead of tapping a
  // live-looking button and getting an error modal back.
  const canAdd = !soldOut && (sizes.length === 0 || sizeOptionId !== null) && groups.filter((g) => g.is_required).every((g) => (selections.get(g.id)?.size ?? 0) > 0);

  function handleAdd() {
    if (soldOut) return;
    if (sizes.length > 0 && !sizeOptionId) {
      setValidationErrorKey('missingRequiredSizeMessage');
      return;
    }
    for (const group of groups.filter((g) => g.is_required)) {
      const selected = selections.get(group.id);
      if (!selected || selected.size === 0) {
        setValidationErrorKey('missingRequiredModifierMessage');
        return;
      }
    }
    const allOptionIds = [...selections.values()].flatMap((s) => [...s]);
    const summary = allOptionIds
      .map((id) => {
        for (const opts of optionsByGroup.values()) {
          const found = opts.find((o) => o.id === id);
          if (found) return found.name;
        }
        return null;
      })
      .filter((n): n is string => n !== null)
      .join(', ');

    addItem({
      dishId: dish.id,
      dishName: dish.name,
      quantity,
      sizeOptionId,
      sizeOptionName: sizeOptionId ? (sizes.find((s) => s.id === sizeOptionId)?.name ?? null) : null,
      modifierOptionIds: allOptionIds,
      modifierSummary: summary,
      unitPrice,
    });
    onAdded();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        {/* Sheet background switched from solid white to the app's neutral
            page background (2026-09-24, per the user's explicit mockup) —
            each choice section below is its own flat WHITE card with no
            border, so the neutral background itself shows through as the
            gap between sections, instead of a border line drawn around
            each one. */}
        <View className="max-h-[85%] rounded-t-2xl" style={{ backgroundColor: colors.background }}>
          {/* No horizontal padding on the ScrollView itself (2026-09-24, per
              the user's explicit request) — each card below spans the full
              sheet width edge-to-edge, so the white background isn't
              inset/limited at the sides. The dish photo specifically sits
              with no padding of its own at all (not even the card's), so it
              gets the card's true full width to fit into rather than being
              squeezed by an extra inset — the direct fix for it looking
              cropped before. Cards that need inner breathing room (text,
              tags) apply their own horizontal padding instead. */}
          <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 16 }}>
            {/* Title + photo + description, now its own edge-to-edge card
                (2026-09-24, per the user's explicit request) — was loose
                content directly on the sheet background before. Thin
                bottom-edge divider (also per explicit request) marks where
                the white card ends and the neutral sheet background begins
                — same colors.border hairline already used for dividers
                elsewhere in this app (e.g. DishRow's own row separator). */}
            <View className="rounded-xl bg-white" style={{ overflow: 'hidden', borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View className="flex-row items-start justify-between px-4 pt-3">
                <Text className="flex-1 text-xl font-bold text-[#1B2430]">{dish.name}</Text>
                <Pressable onPress={onClose} hitSlop={10}>
                  <Ionicons name="close" size={24} color="#6E6A61" />
                </Pressable>
              </View>
              {/* Score badge, stars(+trophy) and Feedstars below the title
                  (2026-09-24, per the user's explicit request) — same real
                  signals and same components as DishRow's own list-card
                  version, just consolidated into one row here instead of
                  split between the title's corner and the row beneath it. */}
              {(dish.rating_count > 0 || dish.feedstars_eligible) && (
                <View className="flex-row flex-wrap items-start px-4" style={{ gap: 6, marginTop: 6 }}>
                  {dish.rating_count > 0 && (
                    <View className="items-center">
                      <View className="items-center rounded px-1.5 py-0.5" style={{ backgroundColor: colors.royalBlue }}>
                        <Text className="text-xs font-bold text-white">{(dish.guest_rating_score ?? 0).toFixed(1)}</Text>
                        <Text className="text-[8px] font-medium text-white">{t(ratingTierLabel(dish.guest_rating_score ?? 0, t))}</Text>
                      </View>
                      {/* Review count below the score (2026-09-27, per
                          explicit request) — real dish.rating_count. */}
                      <Text className="mt-0.5 text-[10px]" style={{ color: colors.textMuted }}>
                        {t('dishReviewCountLabel').replace('{count}', String(dish.rating_count))}
                      </Text>
                    </View>
                  )}
                  {/* Sized up from DishRow's list-card defaults (2026-09-24,
                      per explicit request) — this header has more room than
                      the tightly-tuned list row. */}
                  {dish.rating_count > 0 && <StarRow value={dish.rating_avg ?? 0} size={16} />}
                  {dish.rating_count > 0 && isTopRated && <Ionicons name="trophy" size={17} color="#F5A623" />}
                  {dish.feedstars_eligible && (
                    // Only the icon + wordmark sizes bumped up (2026-09-24,
                    // per the user's correction — not the badge's own
                    // padding/gap, which stay as they were).
                    <View className="flex-row items-center rounded" style={{ backgroundColor: '#F5A623', gap: 2, paddingHorizontal: 5.5, paddingVertical: 1.5 }}>
                      <Ionicons name="sparkles-outline" size={11} color="#FFFFFF" />
                      <Text style={{ fontFamily: 'Baloo2_700Bold', fontSize: 11, color: '#FFFFFF' }}>{t('dishFeedstarsBadge')}</Text>
                    </View>
                  )}
                </View>
              )}
              {dish.photo_urls[0] && <Image source={{ uri: dish.photo_urls[0] }} style={{ width: '100%', height: 180, marginTop: 12 }} />}
              <Text className="px-4 pb-1 pt-3 text-sm font-semibold text-[#1B2430]">{t('dishDescriptionTitle')}</Text>
              <Text className="px-4 pb-3 text-sm leading-5 text-[#6E6A61]">{dish.description || t('dishDescriptionEmpty')}</Text>
              {/* Verified-diner reviews (2026-09-24, per the user's explicit
                  request and mockup) — real published reviews only (see
                  useDishReviews above for the full RLS/moderation reasoning),
                  never shown if there's no real data. positiveReviewCount can
                  be > 0 with zero cards below it (reviews that rated the
                  dish well but left no comment) — that's still a real signal
                  worth showing on its own. */}
              {positiveReviewCount > 0 && (
                <View className="px-4 pb-3" style={{ gap: 8 }}>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                    <Text className="text-xs font-medium" style={{ color: colors.success }}>
                      {t('dishReviewsPositiveSummary').replace('{count}', String(positiveReviewCount))}
                    </Text>
                  </View>
                  {dishReviews.map((review) => (
                    <View key={review.id} className="rounded-lg p-2" style={{ backgroundColor: colors.background, gap: 4 }}>
                      <View className="flex-row items-center" style={{ gap: 6 }}>
                        {review.photoUrl ? (
                          <Image source={{ uri: review.photoUrl }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                        ) : (
                          <View className="items-center justify-center rounded-full" style={{ width: 28, height: 28, backgroundColor: colors.border }}>
                            <Ionicons name="person" size={14} color="#FFFFFF" />
                          </View>
                        )}
                        <Text className="text-xs font-semibold text-[#1B2430]">
                          {review.nickname ?? t('verifiedDinerFallbackLabel')}
                          {review.ageRange ? ` · ${review.ageRange}` : ''}
                        </Text>
                      </View>
                      <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
                        {review.comment}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {/* Soft, non-blocking shortage note (2026-09-24) — a non-critical
                  ingredient (get_dish_missing_ingredients) being out never
                  disables ordering, it just names what won't be included.
                  Detail-modal-only, per the user's explicit choice, not the
                  list row. */}
              {missingIngredientNames.length > 0 && (
                <View className="mx-4 mb-3 flex-row items-start rounded-lg p-2" style={{ gap: 6, backgroundColor: colors.background }}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                  <Text className="flex-1 text-xs" style={{ color: colors.textMuted }}>
                    {t('dishMissingIngredientsNote').replace('{ingredients}', missingIngredientNames.join(', '))}
                  </Text>
                </View>
              )}
            </View>

            {/* Each choice group is its own flat white card, no full border
                (2026-09-24) — the first attempt drew a border around each
                section, but per the user's actual mockup the separation is
                just the neutral page background showing through the gap
                between white cards. A thin bottom-edge divider only (also
                per explicit request) still marks exactly where each card
                ends. */}
            {sizes.length > 0 && (
              <View className="mt-4 rounded-xl bg-white p-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text className="mb-2 text-sm font-semibold text-[#1B2430]">{t('dishSizeSectionTitle')}</Text>
                {/* Blue outline for every selectable tag, filled blue once
                    picked (2026-09-24, per the user's explicit design
                    request) — was a neutral gray border/dark text by
                    default before. */}
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {sizes.map((size) => (
                    <Pressable
                      key={size.id}
                      onPress={() => setSizeOptionId(size.id)}
                      className="rounded-lg border px-3 py-2"
                      style={{ borderColor: colors.royalBlue, backgroundColor: sizeOptionId === size.id ? colors.royalBlue : '#FFFFFF' }}
                    >
                      <Text style={{ color: sizeOptionId === size.id ? '#FFFFFF' : colors.royalBlue }} className="text-sm font-medium">
                        {size.name} · ₪{size.price}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {groups.map((group) => {
              const isAddonGroup = group.name === ADDON_GROUP_NAME;
              const isDonenessGroup = group.name === DONENESS_GROUP_NAME;
              return (
                <View key={group.id} className="mt-4 rounded-xl bg-white p-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <Text className="text-sm font-semibold text-[#1B2430]">{group.name}</Text>
                    {/* Doneness: the red "חובה לבחור" hint is dropped
                        entirely (per explicit request) — no replacement
                        text, the group name stands alone. Addons: its own
                        hint moved to the card's bottom-right (see below).
                        Any other group (none exist today) keeps the original
                        required/optional label here as a fallback. */}
                    {!isAddonGroup && !isDonenessGroup && (
                      <Text className="text-xs" style={{ color: group.is_required ? colors.danger : '#9CA3AF' }}>
                        {group.is_required ? t('dishModifierRequiredLabel') : t('dishModifierOptionalLabel')}
                      </Text>
                    )}
                  </View>
                  {/* Carousel, not a wrapping grid (2026-09-24, per the
                      user's explicit request) — addons and doneness both
                      scroll horizontally now. Photo shown above the tag
                      (64x64), tag itself rectangular with rounded corners
                      like the size tags above (was briefly a full pill —
                      reverted to match). Every tile shares the same fixed
                      width (OPTION_TILE_WIDTH) so a long name (e.g. "תפוח
                      אדמה אפוי") wraps instead of widening its own tile past
                      its siblings. An unavailable option's photo gets a
                      dark-red "אזל" sticker across its bottom edge; a
                      photo-less option gets the same sticker as a small
                      badge next to its tag instead, since there's no image
                      to attach it to. */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2" contentContainerStyle={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingEnd: 4 }}>
                    {(optionsByGroup.get(group.id) ?? []).map((option) => {
                      const selected = (selections.get(group.id) ?? new Set()).has(option.id);
                      const unavailable = unavailableOptionIds.has(option.id);
                      const tagLabel = `${option.name}${option.price_delta > 0 ? ` (+₪${option.price_delta})` : ''}`;
                      return (
                        <Pressable
                          key={option.id}
                          onPress={unavailable ? undefined : () => toggleOption(group, option.id)}
                          disabled={unavailable}
                          style={{ width: OPTION_TILE_WIDTH, alignItems: 'center' }}
                        >
                          {option.photo_url && (
                            <View style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: '#EFEBE2' }}>
                              <Image source={{ uri: option.photo_url }} style={{ width: '100%', height: '100%', opacity: unavailable ? 0.45 : 1 }} resizeMode="cover" />
                              {unavailable && (
                                <View className="absolute inset-x-0 bottom-0 items-center py-1" style={{ backgroundColor: colors.darkRed }}>
                                  <Text className="text-[10px] font-bold text-white">{t('dishSoldOutButton')}</Text>
                                </View>
                              )}
                            </View>
                          )}
                          <View className="w-full items-center rounded-lg border px-2 py-2" style={{ marginTop: option.photo_url ? 6 : 0, gap: 3, borderColor: unavailable ? colors.border : colors.royalBlue, backgroundColor: unavailable ? '#F3F4F6' : selected ? colors.royalBlue : '#FFFFFF' }}>
                            <Text style={{ color: unavailable ? '#9CA3AF' : selected ? '#FFFFFF' : colors.royalBlue }} className="text-center text-xs font-medium" numberOfLines={2}>
                              {tagLabel}
                            </Text>
                            {unavailable && !option.photo_url && (
                              <View className="rounded px-1 py-0.5" style={{ backgroundColor: colors.darkRed }}>
                                <Text className="text-[9px] font-bold text-white">{t('dishSoldOutButton')}</Text>
                              </View>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {/* Addon hint moved to the card's bottom (2026-09-24, per
                      the user's explicit request) — was beside the group
                      title before. alignSelf: 'flex-start' is the physical
                      right under this app's real I18nManager RTL (same
                      convention already established elsewhere in this file,
                      e.g. PriceRow's own flex-end/physical-left comment). */}
                  {isAddonGroup && (
                    <View className="mt-2 flex-row items-center" style={{ gap: 4, alignSelf: 'flex-start' }}>
                      {/* "!" marker on the single-choice case only
                          (2026-09-24) — a real Ionicons glyph now, not a
                          plain Text character, matching the "ניהול חשבון"
                          tab's own info badge (OrderingScreen.tsx's
                          AccountTabBody, "information-outline"). Ionicons has
                          no bare "!" without an enclosing shape the way it
                          does for "i", so alert-circle's own built-in circle
                          is used directly (its solid fill IS the circle —
                          the "!" is the glyph's own cutout, showing through
                          to this white card behind it) instead of layering a
                          separate manually-drawn circle underneath. Same
                          #38BDF8 blue as the reference. */}
                      {group.selection_type === 'single' && <Ionicons name="alert-circle" size={16} color="#38BDF8" />}
                      <Text className="text-xs" style={{ color: '#9CA3AF' }}>
                        {group.selection_type === 'single' ? t('dishAddonPickOneOnly') : t('dishAddonPickMultiple')}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

            {/* bg-white, not colors.background (2026-09-24) — the sheet
                itself now uses that same color, which would make these
                circles blend invisibly into it. */}
            <View className="mt-6 flex-row items-center justify-center" style={{ gap: 16 }}>
              <Pressable onPress={() => setQuantity((q) => Math.max(1, q - 1))} className="h-9 w-9 items-center justify-center rounded-full bg-white">
                <Ionicons name="remove" size={18} color="#1B2430" />
              </Pressable>
              <Text className="text-lg font-semibold text-[#1B2430]">{quantity}</Text>
              <Pressable onPress={() => setQuantity((q) => q + 1)} className="h-9 w-9 items-center justify-center rounded-full bg-white">
                <Ionicons name="add" size={18} color="#1B2430" />
              </Pressable>
            </View>
          </ScrollView>

          {/* No top border here (2026-09-24, per explicit request) — the
              divider convention lives on each content card's own bottom
              edge (description, size, addons, doneness) instead, not on the
              footer bar sitting right above the order button. */}
          <View className="px-4 py-3">
            <Pressable
              onPress={canAdd ? handleAdd : undefined}
              disabled={!canAdd}
              className="flex-row items-center justify-between rounded-xl px-4 py-4"
              style={{ backgroundColor: canAdd ? colors.royalBlue : '#9CA3AF' }}
            >
              <Text className="text-base font-semibold text-white">{soldOut ? t('dishSoldOutButton') : t('addToOrderButton')}</Text>
              {!soldOut && <Text className="text-base font-semibold text-white">₪{(unitPrice * quantity).toFixed(2)}</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      <ErrorModal
        visible={validationErrorKey !== null}
        title={t('placeOrderFailedTitle')}
        message={t(validationErrorKey ?? 'missingRequiredModifierMessage')}
        dismissLabel={t('gotIt')}
        onDismiss={() => setValidationErrorKey(null)}
      />
    </Modal>
  );
}

function CartModal({ visible, onClose, onPlaced }: { visible: boolean; onClose: () => void; onPlaced: () => void }) {
  const { t } = useI18n();
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handlePlaceOrder() {
    if (!sessionId || !participantId || items.length === 0) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke('place-order', {
      body: {
        session_id: sessionId,
        participant_id: participantId,
        items: items.map((item) => ({
          dish_id: item.dishId,
          quantity: item.quantity,
          dish_size_option_id: item.sizeOptionId,
          modifier_option_ids: item.modifierOptionIds,
        })),
      },
    });
    setBusy(false);
    if (error) {
      const code = await extractFunctionErrorCode(error);
      if (code === 'INSUFFICIENT_STOCK') setErrorMessage(t('insufficientStockMessage'));
      else if (code === 'DISH_NOT_AVAILABLE') setErrorMessage(t('dishNotAvailableMessage'));
      else if (code === 'MISSING_REQUIRED_MODIFIER') setErrorMessage(t('missingRequiredModifierMessage'));
      else setErrorMessage(t('placeOrderFailedMessage'));
      return;
    }
    clear();
    onPlaced();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] rounded-t-2xl bg-white">
          <View className="flex-row items-center justify-between border-b p-4" style={{ borderColor: colors.border }}>
            <Text className="text-lg font-bold text-[#1B2430]">{t('cartTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color="#6E6A61" />
            </Pressable>
          </View>

          {items.length === 0 ? (
            <View className="items-center px-6 py-10">
              <Text className="text-center text-sm text-[#9CA3AF]">{t('cartEmpty')}</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ padding: 16 }}>
              {items.map((item) => (
                <View key={item.id} className="mb-3 flex-row items-start justify-between" style={{ gap: 8 }}>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-[#1B2430]">
                      {item.quantity}× {item.dishName}
                    </Text>
                    {(item.sizeOptionName || item.modifierSummary) && (
                      <Text className="mt-0.5 text-xs text-[#9CA3AF]">{[item.sizeOptionName, item.modifierSummary].filter(Boolean).join(' · ')}</Text>
                    )}
                  </View>
                  <Text className="text-sm font-semibold text-[#1B2430]">₪{(item.unitPrice * item.quantity).toFixed(2)}</Text>
                  <Pressable onPress={() => removeItem(item.id)}>
                    <Text className="text-xs font-medium" style={{ color: colors.danger }}>
                      {t('cartItemRemove')}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <View className="border-t px-4 py-3" style={{ borderColor: colors.border }}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-sm font-medium text-[#6E6A61]">{t('cartTotalLabel')}</Text>
              <Text className="text-lg font-bold text-[#1B2430]">₪{cartTotal(items).toFixed(2)}</Text>
            </View>
            <Pressable
              onPress={() => void handlePlaceOrder()}
              disabled={items.length === 0 || busy}
              className="items-center rounded-xl py-4"
              style={{ backgroundColor: items.length === 0 || busy ? '#9CA3AF' : colors.royalBlue }}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-semibold text-white">{t('placeOrderButton')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      <ErrorModal visible={errorMessage !== null} title={t('placeOrderFailedTitle')} message={errorMessage ?? ''} dismissLabel={t('gotIt')} onDismiss={() => setErrorMessage(null)} />
    </Modal>
  );
}

export function MenuBrowser({ onOrderPlaced }: { onOrderPlaced: () => void }) {
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const { data, loading } = useMenuData(restaurantId);
  const orderStats = useDishOrderStats(restaurantId);
  const criticalStock = useDishCriticalStock(restaurantId);
  const missingIngredients = useDishMissingIngredients(restaurantId);
  const unavailableOptions = useUnavailableModifierOptions(restaurantId);
  const [section, setSection] = useState<MenuSection>('food');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const items = useCartStore((s) => s.items);

  if (loading || !data) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.royalBlue} />
      </View>
    );
  }

  const categoriesInSection = data.categories.filter((c) => c.section === section);
  const activeCategory = categoryId ? data.categories.find((c) => c.id === categoryId) : null;
  const dishesInActiveCategory = activeCategory ? (data.dishesByCategory.get(activeCategory.id) ?? []) : [];

  return (
    <View className="flex-1">
      {/* Mockups 7.1/7.2: two icon+label tabs with a blue underline under
          the active one — a distinct, lighter-weight style from
          OrderingTabBar's own amber underline (that one is the app's
          primary nav; this is a sub-toggle inside the Menu tab itself).
          Two equal flex:1 columns (not a centered cluster with a gap) so
          each tab sits centered within its own half of the white strip,
          matching the mockup's left-half/right-half split. */}
      <View className="flex-row border-b bg-white" style={{ borderColor: colors.border }}>
        {(['food', 'drink'] as MenuSection[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setSection(s);
              setCategoryId(null);
            }}
            className="flex-1 flex-row items-center justify-center py-3"
            style={{ gap: 6, borderBottomWidth: section === s ? 2 : 0, borderColor: colors.royalBlue }}
          >
            {s === 'food' ? (
              <MaterialCommunityIcons name="room-service-outline" size={17} color={section === s ? colors.royalBlue : '#6E6A61'} />
            ) : (
              <Ionicons name="wine-outline" size={16} color={section === s ? colors.royalBlue : '#6E6A61'} />
            )}
            <Text className="text-sm font-semibold" style={{ color: section === s ? colors.royalBlue : '#6E6A61' }}>
              {s === 'food' ? t('menuSectionFood') : t('menuSectionDrink')}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeCategory ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          <Pressable onPress={() => setCategoryId(null)} className="flex-row items-center gap-1 p-3">
            <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={16} color={colors.royalBlue} />
            <Text className="text-sm font-medium" style={{ color: colors.royalBlue }}>
              {activeCategory.name}
            </Text>
          </Pressable>
          {dishesInActiveCategory.length === 0 ? (
            <Text className="px-6 py-8 text-center text-sm text-[#9CA3AF]">{t('menuCategoryEmpty')}</Text>
          ) : (
            (() => {
              // Denominator for the "ביקוש גבוה" ratio (item 2) — every
              // dish's own share of today's orders within this same
              // category, computed once per render rather than per row.
              const categoryOrdersToday = dishesInActiveCategory.reduce((sum, d) => sum + (orderStats.get(d.id)?.count ?? 0), 0);
              return dishesInActiveCategory.map((dish) => (
                <DishRow
                  key={dish.id}
                  dish={dish}
                  sizes={data.sizesByDish.get(dish.id) ?? []}
                  onPress={() => setSelectedDish(dish)}
                  t={t}
                  orderStats={orderStats.get(dish.id)}
                  categoryOrdersToday={categoryOrdersToday}
                  criticalStockStatus={criticalStock.get(dish.id)}
                />
              ));
            })()
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
          {categoriesInSection.map((category) => (
            <CategoryCard key={category.id} category={category} dishes={data.dishesByCategory.get(category.id) ?? []} onPress={() => setCategoryId(category.id)} t={t} isRTL={isRTL} />
          ))}
        </ScrollView>
      )}

      {items.length > 0 && (
        <Pressable
          onPress={() => setCartOpen(true)}
          className="absolute flex-row items-center justify-between rounded-xl px-4 py-3"
          style={{ backgroundColor: colors.royalBlue, left: 16, right: 16, bottom: insets.bottom + 16 }}
        >
          <Text className="text-sm font-semibold text-white">
            {items.length} · {t('cartTitle')}
          </Text>
          <Text className="text-sm font-semibold text-white">₪{cartTotal(items).toFixed(2)}</Text>
        </Pressable>
      )}

      {selectedDish && (
        <DishDetailModal
          dish={selectedDish}
          sizes={data.sizesByDish.get(selectedDish.id) ?? []}
          groups={data.groupsByDish.get(selectedDish.id) ?? []}
          optionsByGroup={data.optionsByGroup}
          soldOut={criticalStock.get(selectedDish.id) === 'out'}
          missingIngredientNames={missingIngredients.get(selectedDish.id) ?? []}
          unavailableOptionIds={unavailableOptions}
          onClose={() => setSelectedDish(null)}
          onAdded={() => setSelectedDish(null)}
        />
      )}

      <CartModal
        visible={cartOpen}
        onClose={() => setCartOpen(false)}
        onPlaced={() => {
          setCartOpen(false);
          onOrderPlaced();
        }}
      />
    </View>
  );
}
