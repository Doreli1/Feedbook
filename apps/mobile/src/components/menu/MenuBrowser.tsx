import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Dimensions, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { useNavigation } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { Dish, DishModifierGroup, DishModifierOption, DishSizeOption, MenuCategory, ModifierOptionServingVariant } from '@feedbook/types';
import { ConfirmModal } from '../ConfirmModal';
import { ErrorModal } from '../ErrorModal';
import { useI18n, visualRowDirection, physicalReadingEnd, physicalReadingStart, visualColumnAlign } from '../../lib/i18n';
import type { TranslationKey } from '../../lib/translations';
import { supabase } from '../../lib/supabase';
import { extractFunctionErrorCode } from '../../lib/functionError';
import { cartTotal, useCartStore, type CartLineItem, type CartModifierSelection } from '../../lib/cartStore';
import { formatPrice } from '../../lib/formatPrice';
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
  // Bottle/draft(+size) serving-format choice for a specific drink add-on
  // option (2026-09-29) — empty for every option that doesn't offer one.
  variantsByOption: Map<string, ModifierOptionServingVariant[]>;
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
export function useMenuData(restaurantId: string | null) {
  const [data, setData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) {
      // Reset when restaurantId goes away — nothing to compute during
      // render in its absence.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        // Real bug (2026-10-27, user report): a diner who is ALSO staff at
        // this restaurant (current_staff_restaurant_ids(), see
        // staff_manage_own_restaurant_dish_size_options policy) gets every
        // historical/soft-deleted size row here too, not just the active
        // ones — that staff policy is intentionally unfiltered (the web
        // admin editor needs to see inactive sizes), and RLS policies for
        // the same role OR together, so it widens what this diner-facing
        // query returns for exactly that person. Confirmed against the real
        // local DB: `set role anon` returns only the 2 active rows for a
        // true diner, but a staff member's own session returned all 6.
        // Explicit is_active filter here closes it for every caller,
        // regardless of their other roles — same "don't rely on RLS alone"
        // principle already used elsewhere (see dish_size_options_soft_
        // delete.sql's own comment).
        dishIds.length
          ? supabase.from('dish_size_options').select('*').eq('is_active', true).in('dish_id', dishIds).order('sort_order')
          : Promise.resolve({ data: [] as DishSizeOption[] }),
        dishIds.length
          ? supabase.from('dish_modifier_groups').select('*').in('dish_id', dishIds).order('sort_order')
          : Promise.resolve({ data: [] as DishModifierGroup[] }),
      ]);
      const groupIds = (groups ?? []).map((g) => g.id);
      const { data: options } = groupIds.length
        ? await supabase.from('dish_modifier_options').select('*').in('group_id', groupIds).order('sort_order')
        : { data: [] as DishModifierOption[] };
      const optionIds = (options ?? []).map((o) => o.id);
      const { data: variants } = optionIds.length
        ? await supabase.from('modifier_option_serving_variants').select('*').eq('is_active', true).in('modifier_option_id', optionIds).order('sort_order')
        : { data: [] as ModifierOptionServingVariant[] };

      if (cancelled) return;
      setData({
        categories: categories ?? [],
        dishesByCategory: groupBy(dishes ?? [], (d) => d.category_id),
        sizesByDish: groupBy(sizes ?? [], (s) => s.dish_id),
        groupsByDish: groupBy(groups ?? [], (g) => g.dish_id),
        optionsByGroup: groupBy(options ?? [], (o) => o.group_id),
        variantsByOption: groupBy(variants ?? [], (v) => v.modifier_option_id),
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'modifier_option_serving_variants' }, () => void refresh())
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  return { data, loading };
}

// Restaurant-wide VAT rate (2026-10-01) — restaurants.vat_rate_percent
// already exists and is editable via the Web Admin's own restaurant-details
// screen (RestaurantDetailsForm.tsx, "vatRateLabel"). One-time fetch, no
// realtime subscription: unlike order stats/presence/stock, this is a rarely
// -changed setting, not something a diner needs to see update mid-session.
function useRestaurantVatRate(restaurantId: string | null) {
  const [vatRatePercent, setVatRatePercent] = useState<number | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('restaurants').select('vat_rate_percent').eq('id', restaurantId).single();
      if (!cancelled) setVatRatePercent(data?.vat_rate_percent ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return vatRatePercent;
}

// Which dishes/categories THIS diner has already liked (2026-10-01) — fetched
// once here at the MenuBrowser level, not per-row inside LikeButton. Real bug
// found via real-device feedback: LikeButton used to start every instance at
// liked=false and only flip to true once its own async "did I already like
// this" query resolved — harmless on a long-lived mount, but DishRow/
// CategoryCard genuinely unmount and remount every time a diner leaves a
// category's dish list and comes back (MenuBrowser's own categoryId toggle),
// so the diner saw their already-liked heart visibly reset to empty and then
// "re-fill" red every single time, reading as "it re-activates the like"
// rather than staying permanently marked. MenuBrowser itself never unmounts
// across that same navigation, so fetching here once and handing each row its
// already-correct initial state removes the flash entirely.
function useMyLikes() {
  const [likedDishIds, setLikedDishIds] = useState<Set<string>>(new Set());
  const [likedCategoryIds, setLikedCategoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const [{ data: dishLikes }, { data: categoryLikes }] = await Promise.all([
        supabase.from('dish_likes').select('dish_id').eq('user_id', user.id),
        supabase.from('menu_category_likes').select('category_id').eq('user_id', user.id),
      ]);
      if (cancelled) return;
      setLikedDishIds(new Set((dishLikes ?? []).map((r) => r.dish_id)));
      setLikedCategoryIds(new Set((categoryLikes ?? []).map((r) => r.category_id)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { likedDishIds, likedCategoryIds };
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

// Live "diners looking at this exact dish right now" count (2026-09-29,
// explicit user decision after clarifying this is a genuinely different
// feature from the cumulative "views today" counter above: a real-time
// snapshot of who's actually on the dish's detail screen this instant, not a
// running daily total). Built on Supabase Realtime Presence, not a DB table —
// presence is inherently ephemeral (a client that closes the app, navigates
// away, or loses connection is dropped automatically), which is exactly the
// "always accurate right now" property this needs and a persisted-row
// approach could never give without a fragile heartbeat/expiry scheme.
// One shared channel per restaurant (matching the restaurant_inventory /
// restaurant_dish_views topic convention) rather than one channel per dish.
//
// 2026-10-01 (real crash fix): DishDetailModal used to open its OWN second
// channel on this exact same topic string to call track() on. That looked
// like two independent RealtimeChannel instances sharing a topic server-
// side, but supabase-js's own .channel(topic) dedupes by topic client-side
// too (RealtimeClient.channel(), returns the existing instance if one's
// already registered for that topic) — so the "second" channel was actually
// THE SAME object this hook had already subscribed. Opening a dish modal
// then closing it called removeChannel() on that shared object, killing
// this hook's own subscription out from under it with no re-render to
// notice; the exact crash this surfaced with ("cannot add presence
// callbacks ... after subscribe()") happened when this hook's effect later
// re-ran (Fast Refresh) while that shared channel was still alive and
// already joined, and .on() was called on it a second time. Fix: this hook
// is now the channel's ONLY owner, start to finish — it exposes trackDish/
// untrackDish instead of letting the modal manage any channel of its own.
function useDishPresence(restaurantId: string | null) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    const topic = `dish_presence:${restaurantId}`;
    // Defense-in-depth for this hook's OWN Fast-Refresh remount race (not
    // the cross-hook collision above, which the rewrite already removes):
    // if this effect re-runs before its own previous cleanup's
    // removeChannel finished, .channel() would otherwise hand back that
    // still-subscribed instance and .on() would throw on it.
    for (const existing of supabase.getChannels()) {
      if (existing.topic === `realtime:${topic}`) void supabase.removeChannel(existing);
    }
    const channel = supabase.channel(topic, { config: { private: true } });
    channelRef.current = channel;
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ dish_id: string }>();
      const next = new Map<string, number>();
      for (const metas of Object.values(state)) {
        for (const meta of metas) {
          next.set(meta.dish_id, (next.get(meta.dish_id) ?? 0) + 1);
        }
      }
      setCounts(next);
    });
    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('dish_presence subscribe failed', status, err);
    });
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const trackDish = useCallback((dishId: string) => {
    void channelRef.current?.track({ dish_id: dishId }).then((res) => {
      if (res !== 'ok') console.warn('dish_presence track failed', res);
    });
  }, []);
  const untrackDish = useCallback(() => {
    void channelRef.current?.untrack();
  }, []);

  return { counts, trackDish, untrackDish };
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
  // Singular wording (2026-10-01, per explicit request) — "סועד אחד הזמין
  // היום" instead of the plural template's "{count} סועדים הזמינו היום"
  // reading as "1 סועדים" when count is exactly 1. Applies to both the
  // count-only and the with-last-order-time variants.
  const countOnly = stats.count === 1 ? t('dishOrdersTodaySingularLabel') : t('dishOrdersTodayLabel').replace('{count}', String(stats.count));
  if (minutesAgo < 1 || minutesAgo > 180) return countOnly;
  const timeLabel = minutesAgo > 60 ? t('dishHoursAgo').replace('{hours}', String(Math.round(minutesAgo / 60))) : t('dishMinutesAgo').replace('{minutes}', String(minutesAgo));
  const withLastKey = stats.count === 1 ? 'dishOrdersTodayWithLastSingularLabel' : 'dishOrdersTodayWithLastLabel';
  return t(withLastKey).replace('{count}', String(stats.count)).replace('{time}', timeLabel);
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

// Resolves a dish's discount against a specific already-resolved base price
// (the flat dish.price, or one specific dish_size_options row) — shared by
// PriceRow's own card-display math and DishDetailModal's unitPrice below, so
// the cart/order total a diner is actually charged can never drift from what
// the card showed (2026-10-01: found via real-device feedback that
// DishDetailModal's unitPrice completely ignored the discount entirely —
// the "הוסיפו להזמנה" total and the cart were charging the FULL price even
// for a discounted dish, invisible until checkout, where the server's own
// place_order_transaction silently applied the real discount anyway).
//
// Three sources, in the same priority order as place_order_transaction
// itself: 1) the chosen size's OWN discount_fixed_price override (2026-10-01
// follow-up, per explicit request — a dish with several differently-priced
// sizes, e.g. the smoked entrecote at ₪90/₪130, can't use one dish-wide fixed
// price, so each size gets its own optional one instead); 2) the dish-level
// 'fixed_price' mode, only ever meaningful on a sizeless dish (size is null)
// — enforced in the Web Admin form; 3) the dish-level percent, the uniform
// fallback that still applies to any size with no override of its own.
// `size` is null for a flat-price dish or before a size is chosen.
// Returns the RAW (unrounded) discounted value — callers round for display/
// charging, since PriceRow also needs the raw value to compute the badge's
// exact-vs-"כ-" percent.
function resolveDishDiscountRaw(dish: Dish, base: number, size: DishSizeOption | null): number {
  if (size && size.discount_fixed_price != null) {
    return size.discount_fixed_price;
  }
  if (!size && dish.discount_mode === 'fixed_price' && dish.discount_fixed_price != null) {
    return dish.discount_fixed_price;
  }
  if (dish.discount_percent > 0) {
    return base * (1 - dish.discount_percent / 100);
  }
  return base;
}

function hasAnyDishDiscount(dish: Dish, size: DishSizeOption | null): boolean {
  if (size) return size.discount_fixed_price != null || dish.discount_percent > 0;
  return dish.discount_mode === 'fixed_price' ? dish.discount_fixed_price != null : dish.discount_percent > 0;
}

// Effective price a diner actually pays for a dish — the cheapest size's
// discounted price when a discount applies, otherwise the plain base price.
// Shared by the price-range filter and the price-sort options below
// (2026-10-01, per explicit request), so both use the exact same number
// already shown on the card.
function effectiveDishPrice(dish: Dish, sizes: DishSizeOption[]): number {
  const cheapestSize = sizes.length > 0 ? sizes.reduce((min, s) => (s.price < min.price ? s : min), sizes[0]!) : null;
  const basePrice = cheapestSize ? cheapestSize.price : dish.price;
  if (!hasAnyDishDiscount(dish, cheapestSize)) return basePrice;
  return Math.round(resolveDishDiscountRaw(dish, basePrice, cheapestSize));
}

// Price-range buckets (2026-10-01, matching mockup
// 7.1.1.2-Meats menus filter.JPG exactly: ₪0-30, ₪30-50, ₪50-80, ₪80-120,
// ₪120+).
type PriceBucket = '0-30' | '30-50' | '50-80' | '80-120' | '120+';
const PRICE_BUCKETS: PriceBucket[] = ['0-30', '30-50', '50-80', '80-120', '120+'];

function priceBucketLabel(bucket: PriceBucket): string {
  switch (bucket) {
    case '0-30':
      return '₪0 - ₪30';
    case '30-50':
      return '₪30 - ₪50';
    case '50-80':
      return '₪50 - ₪80';
    case '80-120':
      return '₪80 - ₪120';
    case '120+':
      return '₪120+';
  }
}

function matchesPriceBucket(price: number, bucket: PriceBucket): boolean {
  switch (bucket) {
    case '0-30':
      return price <= 30;
    case '30-50':
      return price > 30 && price <= 50;
    case '50-80':
      return price > 50 && price <= 80;
    case '80-120':
      return price > 80 && price <= 120;
    case '120+':
      return price > 120;
  }
}

// Sort options offered on the dish-list-within-category screen (2026-10-01,
// per explicit request) — null means the list's own default order.
type DishSortOption = 'popularity' | 'rating' | 'price_asc' | 'price_desc' | 'feedstars' | null;

// All filter groups the user asked for: the three shown in mockup 7.1.1.2
// (budget/stars/guest-rating) plus two described verbally, not pictured
// there (allergen exclusion, availability-only). priceBucket/starRating/
// guestRatingMin are single-select within their own group (tapping the same
// chip again clears it); excludedAllergens is the one multi-select group,
// since excluding more than one allergen at once is the whole point of it.
interface DishFilterState {
  priceBucket: PriceBucket | null;
  starRating: number | null; // 0 = "ללא דירוג" (rating_count === 0), 2-5 = exact rounded star count
  guestRatingMin: number | null; // 0 = "ללא דירוג", 5-9 = minimum guest_rating_score
  excludedAllergens: Set<string>;
  availableOnly: boolean;
}

const DEFAULT_DISH_FILTERS: DishFilterState = {
  priceBucket: null,
  starRating: null,
  guestRatingMin: null,
  excludedAllergens: new Set(),
  availableOnly: false,
};

function dishFilterIsEmpty(filters: DishFilterState): boolean {
  return (
    filters.priceBucket === null &&
    filters.starRating === null &&
    filters.guestRatingMin === null &&
    filters.excludedAllergens.size === 0 &&
    !filters.availableOnly
  );
}

// One dish's pass/fail against the full filter state. Shared by the actual
// dish-list rendering and by the filter screen's own live per-chip counts —
// `skipGroup` lets a chip's count reflect every OTHER active group without
// also being gated by its own group's current selection (2026-10-01).
function dishMatchesFilters(
  dish: Dish,
  price: number,
  criticalStockStatus: 'low' | 'out' | undefined,
  filters: DishFilterState,
  skipGroup?: keyof DishFilterState,
): boolean {
  if (skipGroup !== 'priceBucket' && filters.priceBucket && !matchesPriceBucket(price, filters.priceBucket)) return false;
  if (skipGroup !== 'starRating' && filters.starRating !== null) {
    const rounded = dish.rating_count > 0 ? Math.round(dish.rating_avg ?? 0) : 0;
    if (rounded !== filters.starRating) return false;
  }
  if (skipGroup !== 'guestRatingMin' && filters.guestRatingMin !== null) {
    if (filters.guestRatingMin === 0) {
      if (dish.rating_count > 0) return false;
    } else if (dish.rating_count === 0 || (dish.guest_rating_score ?? 0) < filters.guestRatingMin) {
      return false;
    }
  }
  if (skipGroup !== 'excludedAllergens' && filters.excludedAllergens.size > 0 && dish.allergens.some((a) => filters.excludedAllergens.has(a))) {
    return false;
  }
  if (skipGroup !== 'availableOnly' && filters.availableOnly && criticalStockStatus === 'out') return false;
  return true;
}

function sortDishesForDisplay(
  dishes: Dish[],
  sortOption: DishSortOption,
  orderStats: Map<string, DishOrderStats>,
  sizesByDish: Map<string, DishSizeOption[]>,
): Dish[] {
  if (!sortOption) return dishes;
  const sorted = [...dishes];
  switch (sortOption) {
    case 'popularity':
      sorted.sort((a, b) => (orderStats.get(b.id)?.count ?? 0) - (orderStats.get(a.id)?.count ?? 0));
      break;
    case 'rating':
      sorted.sort((a, b) => (b.guest_rating_score ?? 0) - (a.guest_rating_score ?? 0));
      break;
    case 'price_asc':
      sorted.sort((a, b) => effectiveDishPrice(a, sizesByDish.get(a.id) ?? []) - effectiveDishPrice(b, sizesByDish.get(b.id) ?? []));
      break;
    case 'price_desc':
      sorted.sort((a, b) => effectiveDishPrice(b, sizesByDish.get(b.id) ?? []) - effectiveDishPrice(a, sizesByDish.get(a.id) ?? []));
      break;
    case 'feedstars':
      sorted.sort((a, b) => Number(b.feedstars_eligible) - Number(a.feedstars_eligible));
      break;
  }
  return sorted;
}

// Chip used across every filter-screen section below (2026-10-01) — label
// first in source order so RTL puts it physically right (read first), the
// live count second (physically left), matching the mockup's own
// "<range> (<count>)" reading order. `tone` lets the allergen section (an
// EXCLUDE action) read visually differently from the other three sections
// (an INCLUDE/narrow-to action) even though the selected/unselected mechanic
// is identical.
function FilterChip({
  label,
  count,
  selected,
  onPress,
  tone = 'include',
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
  tone?: 'include' | 'exclude';
}) {
  const { isRTL } = useI18n();
  const activeColor = tone === 'exclude' ? colors.brightRed : colors.royalBlue;
  return (
    <Pressable
      onPress={onPress}
      className="items-center rounded-lg border px-3 py-2"
      style={{ flexDirection: visualRowDirection(isRTL), gap: 4, borderColor: selected ? activeColor : colors.border, backgroundColor: selected ? activeColor : '#FFFFFF' }}
    >
      <Text className="text-sm font-medium" style={{ color: selected ? '#FFFFFF' : colors.ink }}>
        {label}
      </Text>
      <Text className="text-xs" style={{ color: selected ? '#FFFFFF' : colors.textMuted }}>
        ({count})
      </Text>
    </Pressable>
  );
}

// Replaces the food/drink section toggle once inside a specific category's
// dish list (2026-10-01, per explicit request + mockup
// 7.1.1.2-Meats menus filter.JPG) — that section choice no longer applies
// once a diner has already drilled into one category's own dishes. Filter
// first in source order so RTL puts it physically right (matching the
// mockup's own funnel-on-the-right / sort-arrows-on-the-left layout); the
// small dot marks an active filter so it's visible even once the sheet/
// screen themselves are closed.
function FilterSortBar({
  onOpenFilter,
  onOpenSort,
  hasActiveFilters,
  t,
}: {
  onOpenFilter: () => void;
  onOpenSort: () => void;
  hasActiveFilters: boolean;
  t: (key: TranslationKey) => string;
}) {
  // Real bug (2026-10-27): plain flex-row relied on a native RTL flag that
  // doesn't reliably flip on a real device — see i18n.tsx's
  // visualRowDirection for why this is driven explicitly instead.
  const { isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  return (
    <View style={{ flexDirection: rowDirection, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }}>
      <Pressable onPress={onOpenSort} className="flex-1 items-center justify-center py-3" style={{ flexDirection: rowDirection, gap: 6 }}>
        <Ionicons name="swap-vertical-outline" size={18} color={colors.royalBlue} />
        <Text className="text-sm font-semibold" style={{ color: colors.royalBlue }}>
          {t('dishSortButton')}
        </Text>
      </Pressable>
      <Pressable onPress={onOpenFilter} className="flex-1 items-center justify-center py-3" style={{ flexDirection: rowDirection, gap: 6 }}>
        <Ionicons name="funnel-outline" size={16} color={colors.royalBlue} />
        <Text className="text-sm font-semibold" style={{ color: colors.royalBlue }}>
          {t('dishFilterButton')}
        </Text>
        {hasActiveFilters && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brightRed }} />}
      </Pressable>
    </View>
  );
}

// Bottom sheet, standard single-select list (2026-10-01) — tapping the
// already-active option clears the sort back to the list's own default
// order, same "tap again to deselect" convention the filter chips use.
function SortSheet({
  visible,
  onClose,
  value,
  onChange,
  t,
}: {
  visible: boolean;
  onClose: () => void;
  value: DishSortOption;
  onChange: (next: DishSortOption) => void;
  t: (key: TranslationKey) => string;
}) {
  const { isRTL } = useI18n();
  const options: { key: Exclude<DishSortOption, null>; labelKey: TranslationKey }[] = [
    { key: 'popularity', labelKey: 'dishSortPopularity' },
    { key: 'rating', labelKey: 'dishSortRatingHigh' },
    { key: 'price_asc', labelKey: 'dishSortPriceAsc' },
    { key: 'price_desc', labelKey: 'dishSortPriceDesc' },
    { key: 'feedstars', labelKey: 'dishSortFeedstars' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
        <View style={{ backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 }}>
          <Text className="p-4 text-base font-bold" style={{ color: colors.ink }}>
            {t('dishSortSheetTitle')}
          </Text>
          {options.map((opt) => {
            const selected = value === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  onChange(selected ? null : opt.key);
                  onClose();
                }}
                className="items-center px-4 py-3"
                style={{ flexDirection: visualRowDirection(isRTL), gap: 10 }}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? colors.royalBlue : '#9CA3AF'}
                />
                <Text className="text-base" style={{ color: selected ? colors.royalBlue : colors.ink, fontWeight: selected ? '700' : '400' }}>
                  {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

// Full-screen filter modal (2026-10-01) — matches mockup
// 7.1.1.2-Meats menus filter.JPG's three sections (budget/stars/guest
// rating) exactly, plus two more sections described verbally but not
// pictured there (allergens to exclude, availability-only). Every chip's
// count is computed against the category's full dish list with every OTHER
// group's filter still applied, but ignoring its OWN group's current
// selection (dishMatchesFilters' skipGroup) — so a chip's own count doesn't
// collapse to itself once chosen, while still reacting to the other active
// filters.
function FilterScreen({
  visible,
  onClose,
  filters,
  onChange,
  dishes,
  sizesByDish,
  criticalStock,
  t,
}: {
  visible: boolean;
  onClose: () => void;
  filters: DishFilterState;
  onChange: (next: DishFilterState) => void;
  dishes: Dish[];
  sizesByDish: Map<string, DishSizeOption[]>;
  criticalStock: Map<string, 'low' | 'out' | undefined>;
  t: (key: TranslationKey) => string;
}) {
  const { isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const priced = dishes.map((d) => ({ dish: d, price: effectiveDishPrice(d, sizesByDish.get(d.id) ?? []) }));

  function countFor(skipGroup: keyof DishFilterState, predicate: (dish: Dish, price: number) => boolean): number {
    return priced.filter(
      ({ dish, price }) => predicate(dish, price) && dishMatchesFilters(dish, price, criticalStock.get(dish.id), filters, skipGroup),
    ).length;
  }

  const totalMatching = priced.filter(({ dish, price }) => dishMatchesFilters(dish, price, criticalStock.get(dish.id), filters)).length;

  const allergenCounts = new Map<string, number>();
  for (const dish of dishes) {
    for (const a of dish.allergens) allergenCounts.set(a, (allergenCounts.get(a) ?? 0) + 1);
  }
  const allAllergens = [...allergenCounts.keys()].sort();

  const guestRatingOptions: { value: number; labelKey: TranslationKey }[] = [
    { value: 5, labelKey: 'dishFilterGuestRating5' },
    { value: 6, labelKey: 'dishFilterGuestRating6' },
    { value: 7, labelKey: 'dishFilterGuestRating7' },
    { value: 8, labelKey: 'dishFilterGuestRating8' },
    { value: 9, labelKey: 'dishFilterGuestRating9' },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <View className="items-center justify-between border-b px-4 py-3" style={{ flexDirection: rowDirection, borderColor: colors.border }}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
          <Pressable onPress={() => onChange(DEFAULT_DISH_FILTERS)} hitSlop={8}>
            <Text className="text-sm font-semibold" style={{ color: colors.royalBlue }}>
              {t('dishFilterReset')}
            </Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <Text className="mb-2 text-sm font-bold" style={{ color: colors.ink }}>
            {t('dishFilterBudgetSection')}
          </Text>
          <View className="mb-5 flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
            {PRICE_BUCKETS.map((bucket) => (
              <FilterChip
                key={bucket}
                label={priceBucketLabel(bucket)}
                count={countFor('priceBucket', (_dish, price) => matchesPriceBucket(price, bucket))}
                selected={filters.priceBucket === bucket}
                onPress={() => onChange({ ...filters, priceBucket: filters.priceBucket === bucket ? null : bucket })}
              />
            ))}
          </View>

          <Text className="mb-2 text-sm font-bold" style={{ color: colors.ink }}>
            {t('dishFilterStarsSection')}
          </Text>
          <View className="mb-5 flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
            <FilterChip
              label={t('dishFilterNoRating')}
              count={countFor('starRating', (dish) => dish.rating_count === 0)}
              selected={filters.starRating === 0}
              onPress={() => onChange({ ...filters, starRating: filters.starRating === 0 ? null : 0 })}
            />
            {[2, 3, 4, 5].map((stars) => (
              <FilterChip
                key={stars}
                label={t('dishFilterStars').replace('{count}', String(stars))}
                count={countFor('starRating', (dish) => dish.rating_count > 0 && Math.round(dish.rating_avg ?? 0) === stars)}
                selected={filters.starRating === stars}
                onPress={() => onChange({ ...filters, starRating: filters.starRating === stars ? null : stars })}
              />
            ))}
          </View>

          <Text className="mb-2 text-sm font-bold" style={{ color: colors.ink }}>
            {t('dishFilterGuestRatingSection')}
          </Text>
          <View className="mb-5 flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
            <FilterChip
              label={t('dishFilterNoRating')}
              count={countFor('guestRatingMin', (dish) => dish.rating_count === 0)}
              selected={filters.guestRatingMin === 0}
              onPress={() => onChange({ ...filters, guestRatingMin: filters.guestRatingMin === 0 ? null : 0 })}
            />
            {guestRatingOptions.map((opt) => (
              <FilterChip
                key={opt.value}
                label={t(opt.labelKey)}
                count={countFor('guestRatingMin', (dish) => dish.rating_count > 0 && (dish.guest_rating_score ?? 0) >= opt.value)}
                selected={filters.guestRatingMin === opt.value}
                onPress={() => onChange({ ...filters, guestRatingMin: filters.guestRatingMin === opt.value ? null : opt.value })}
              />
            ))}
          </View>

          {allAllergens.length > 0 && (
            <>
              <Text className="mb-2 text-sm font-bold" style={{ color: colors.ink }}>
                {t('dishFilterAllergensSection')}
              </Text>
              <View className="mb-5 flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
                {allAllergens.map((allergen) => (
                  <FilterChip
                    key={allergen}
                    tone="exclude"
                    label={allergen}
                    count={countFor('excludedAllergens', (dish) => dish.allergens.includes(allergen))}
                    selected={filters.excludedAllergens.has(allergen)}
                    onPress={() => {
                      const next = new Set(filters.excludedAllergens);
                      if (next.has(allergen)) next.delete(allergen);
                      else next.add(allergen);
                      onChange({ ...filters, excludedAllergens: next });
                    }}
                  />
                ))}
              </View>
            </>
          )}

          <Text className="mb-2 text-sm font-bold" style={{ color: colors.ink }}>
            {t('dishFilterAvailabilitySection')}
          </Text>
          <Pressable
            onPress={() => onChange({ ...filters, availableOnly: !filters.availableOnly })}
            className="items-center rounded-lg border px-3 py-2.5"
            style={{ flexDirection: rowDirection, gap: 8, borderColor: filters.availableOnly ? colors.royalBlue : colors.border }}
          >
            <Ionicons
              name={filters.availableOnly ? 'checkbox' : 'square-outline'}
              size={20}
              color={filters.availableOnly ? colors.royalBlue : colors.textMuted}
            />
            <Text className="text-sm font-medium" style={{ color: colors.ink }}>
              {t('dishFilterAvailableOnly')}
            </Text>
          </Pressable>
        </ScrollView>
        <View className="border-t px-4 py-3" style={{ borderColor: colors.border }}>
          <Pressable onPress={onClose} className="items-center justify-center rounded-lg" style={{ backgroundColor: colors.royalBlue, paddingVertical: 12 }}>
            <Text className="text-sm font-semibold text-white">{t('dishFilterShowResults')}</Text>
          </Pressable>
          <Text className="mt-2 text-center text-xs" style={{ color: colors.textMuted }}>
            {t('dishFilterResultsCount').replace('{filtered}', String(totalMatching)).replace('{total}', String(dishes.length))}
          </Text>
        </View>
      </View>
    </Modal>
  );
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

// Discounted-price treatment (2026-10-01, per explicit request, reworked
// from the original single-row layout): now a 3-line stack —
// 1) the price line itself (original price crossed out in red, discounted
//    price beside it — or just the plain price when there's no discount),
// 2) the "חסכו X%" discount-saved badge (green bg, white text), only when
//    there's actually a discount,
// 3) the VAT-included label, only when the restaurant has a vat_rate_percent
//    to show (see useRestaurantVatRate below).
// Original price uses colors.originalPriceRed, a dedicated token — not
// colors.danger, which theme.ts explicitly reserves for sign-out/destructive
// actions only. RTL row: original price comes first in source order so it
// lands on the physical right (read first), discounted price follows to its
// left.
function PriceRow({
  dish,
  sizes,
  t,
  vatRatePercent,
  almostOutLabel,
}: {
  dish: Dish;
  sizes: DishSizeOption[];
  t: (key: TranslationKey) => string;
  vatRatePercent: number | null;
  // "כמעט אזל" text (2026-10-01, reworked) — always rendered inside PriceRow
  // now, right next to whichever line it's actually relevant beside (the
  // price line itself when there's no discount, the discount badge when
  // there is). It used to sit in DishRow's own wrapping row, beside the
  // whole PriceRow column — which put it beside the VAT label's own line
  // too whenever that line was the widest one, visibly detaching it from
  // the price and letting the row overflow (real-device feedback, smoked
  // entrecote steak).
  almostOutLabel: string | null;
}) {
  const { isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  // mt-1.5 (2026-10-01, per explicit request, gentle increase) — this line
  // had no top spacing at all before, sitting flush against the discount/
  // almost-out row right above it. text-[10px] (2026-10-01 follow-up, same
  // gentle-increase request) — was text-[9px].
  const vatLabel = vatRatePercent != null && (
    <Text className="mt-1.5 text-[10px]" style={{ color: colors.textMuted }}>
      {t('dishVatIncludedLabel').replace('{percent}', String(vatRatePercent))}
    </Text>
  );

  // Cheapest size specifically (not just its price) — needed to check that
  // exact size's own discount_fixed_price override (2026-10-01 follow-up).
  // null for a sizeless dish, where the dish-level fields govern instead.
  const cheapestSize = sizes.length > 0 ? sizes.reduce((min, s) => (s.price < min.price ? s : min), sizes[0]!) : null;
  const hasDiscount = hasAnyDishDiscount(dish, cheapestSize);

  if (!hasDiscount) {
    return (
      // Real bug (2026-10-28): see visualColumnAlign's own comment in
      // i18n.tsx — a column's cross axis is horizontal, so alignItems
      // flex-start/flex-end here genuinely is direction-aware, through the
      // same stuck I18nManager.isRTL flag flexDirection uses. Anchored to
      // the same physical side as the price block's own outer wrapper in
      // DishRow (physicalReadingEnd), so the row/vatLabel line up with it.
      <View style={{ alignItems: visualColumnAlign(physicalReadingEnd(isRTL)) }}>
        <View className="items-center" style={{ flexDirection: rowDirection, gap: 6 }}>
          {/* "כמעט אזל" first in source order so RTL puts it on the physical
              right of the price, matching this row's own established
              convention. */}
          {/* Sized up slightly (2026-10-01, per explicit request, gentle
              increase) — was text-[10px]. */}
          {almostOutLabel && (
            <Text className="text-[11px] font-semibold" style={{ color: colors.brightRed }}>
              {almostOutLabel}
            </Text>
          )}
          {/* Sized up slightly (2026-10-01, per explicit request, gentle
              increase) — was text-sm (14px). */}
          <Text className="text-base font-semibold" style={{ color: colors.royalBlue }}>
            {priceLabel(dish, sizes, t)}
          </Text>
        </View>
        {vatLabel}
      </View>
    );
  }
  // "From" only once sizes span 2+ distinct prices (2026-09-29) — same rule
  // as priceLabel above, not just 2+ options.
  const hasMultiplePrices = new Set(sizes.map((s) => s.price)).size > 1;
  const basePrice = sizes.length >= 1 ? Math.min(...sizes.map((s) => s.price)) : dish.price;
  const prefix = hasMultiplePrices ? `${t('dishPriceFrom')} ` : '';
  // Always a whole price (2026-10-01, per explicit request) — a percentage
  // discount can land on an agorot value (e.g. 15% off ₪45 = ₪38.25); either
  // kind of fixed price is already meant to be a clean number but gets the
  // same defensive rounding for display consistency. This matches
  // place_order_transaction's own rounding, so what's shown is what's
  // actually charged.
  const discountedRaw = resolveDishDiscountRaw(dish, basePrice, cheapestSize);
  const discounted = Math.round(discountedRaw);
  // The badge always shows a whole percent, always rounded UP (2026-10-01,
  // per explicit request) — exact when the discount is a direct percent,
  // but DERIVED from two prices (and essentially never a whole number) when
  // it comes from either kind of fixed price. Whenever ceiling actually
  // changed the value, the badge switches to the "כ-" (approximately)
  // wording instead of stating it as exact.
  //
  // Deliberately NOT computed as (1 - discountedRaw / basePrice) * 100 in
  // the plain-percent case: that division reintroduces floating-point
  // drift even for an exact configured value (e.g. 45 * (1 - 15/100) then
  // back through (1 - 38.25/45) * 100 lands on 15.000000000000002, not 15),
  // which would wrongly flag an exact 15% as needing "כ-".
  const isFixedPriceSource = (cheapestSize?.discount_fixed_price ?? null) != null || (!cheapestSize && dish.discount_mode === 'fixed_price');
  const truePercent = isFixedPriceSource ? (1 - discountedRaw / basePrice) * 100 : dish.discount_percent;
  const displayPercent = Math.ceil(truePercent);
  const isApprox = displayPercent !== truePercent;
  return (
    // Real bug (2026-10-28): same visualColumnAlign fix as the no-discount
    // branch above.
    <View style={{ alignItems: visualColumnAlign(physicalReadingEnd(isRTL)) }}>
      <View className="items-end" style={{ flexDirection: rowDirection, gap: 4 }}>
        {/* "החל מ-" split out of the strikethrough price (2026-10-01, per
            explicit request) — it used to be inside the same struck-through
            Text as the original price, so the line ran through the label
            text too, not just the number. First in source order so RTL puts
            it rightmost, read first: "החל מ-" → original price (red, struck)
            → discounted price (blue, bold).
            2026-10-01 (follow-up, per explicit request + screenshot):
            matched to the discounted price's own color/weight instead of a
            small muted label — the two read as one unit, with only the
            struck original price staying visually secondary.
            2026-10-01 (follow-up): sized back down a notch (17px→14px, gap
            5→4) — kept the color/weight match, just not the same literal
            size as the price number itself.
            2026-10-01 (follow-up): items-end (was items-center) so the
            smaller original/prefix text sit on the discounted price's own
            bottom line instead of floating centered against its taller
            height; the original price also moved into its own tight
            sub-group with the discounted price (gap 2, not 4) so it reads as
            attached to it specifically, closer than its distance from the
            "החל מ-" label. */}
        {prefix !== '' && (
          <Text className="text-sm font-bold" style={{ color: colors.royalBlue }}>
            {prefix}
          </Text>
        )}
        <View className="items-end" style={{ flexDirection: rowDirection, gap: 2 }}>
          <Text className="text-xs" style={{ color: colors.originalPriceRed, textDecorationLine: 'line-through' }}>
            ₪{basePrice}
          </Text>
          {/* Bolder/larger than before (2026-10-01, per explicit request) —
              same emphasis treatment as the dish-detail modal's own per-size
              discount tags, applied here too, nothing else in the row
              resized. Sized up once more (2026-10-01 follow-up, gentle
              increase) — was text-base (16px).
              2026-10-01 (follow-up): a literal space ("₪ {discounted}")
              let the bidi algorithm split the symbol from the number into
              separate runs and reorder them, pushing the symbol to the
              wrong side — real-device feedback. Split into its own flex-row
              instead, immune to bidi reordering since each is its own flex
              item, not adjacent characters in one text run.
              2026-10-01 (follow-up again, confirmed on-device): the first
              attempt put ₪ first in source expecting it to land on the
              physical right (this file's usual flex-row/RTL convention),
              but real-device feedback showed the opposite is what this
              specific plain "₪80" layout actually needs — the number first
              (physical right), ₪ second (physical left) — matching how the
              untouched, never-complained-about `₪{basePrice}` right above
              this already renders as plain unflexed text. */}
          <View className="items-end" style={{ flexDirection: rowDirection, gap: 2 }}>
            <Text className="text-[17px] font-bold" style={{ color: colors.royalBlue }}>
              {discounted}
            </Text>
            <Text className="text-[17px] font-bold" style={{ color: colors.royalBlue }}>
              ₪
            </Text>
          </View>
        </View>
      </View>
      <View className="mt-1 items-center" style={{ flexDirection: rowDirection, gap: 6 }}>
        <View className="rounded px-1 py-0.5" style={{ backgroundColor: colors.discountGreenDark }}>
          <Text className="text-[9px] font-bold text-white">
            {t(isApprox ? 'dishDiscountSavedApproxBadge' : 'dishDiscountSavedBadge').replace('{percent}', String(displayPercent))}
          </Text>
        </View>
        {/* "כמעט אזל" beside the discount badge (2026-10-01, per explicit
            request) — badge first in source order so RTL puts it on the
            physical right, with this label landing to its physical left. */}
        {/* Sized up slightly (2026-10-01, per explicit request, gentle
            increase) — was text-[10px]. */}
        {almostOutLabel && (
          <Text className="text-[11px] font-semibold" style={{ color: colors.brightRed }}>
            {almostOutLabel}
          </Text>
        )}
      </View>
      {vatLabel}
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
  initiallyLiked,
  showCount = true,
  positionStyle,
  iconSize = 18,
  hitSlop = 8,
}: {
  table: 'dish_likes' | 'menu_category_likes';
  id: string | undefined;
  initialCount: number;
  // 2026-10-01: resolved once by useMyLikes at the MenuBrowser level (not
  // fetched independently per-row here) — see that hook's own comment for
  // the visible "like resets then re-activates on every screen return" bug
  // this replaced.
  initiallyLiked: boolean;
  // 2026-10-01: DishRow wants the same toggle in the title's corner (where
  // the score badge used to sit) with no count beside it — a plain icon,
  // not the white pill this button was originally built for on top of a
  // photo. `showCount=false` drops the count Text and the pill chrome;
  // `positionStyle` lets that caller place it (absolute, top:0/end:0) since
  // the pill's own hardcoded top:8/right:8 was tuned for CategoryCard's
  // photo corner specifically.
  showCount?: boolean;
  positionStyle?: { position: 'absolute'; top: number; bottom?: number; left?: number; right?: number };
  iconSize?: number;
  hitSlop?: number;
}) {
  // Supabase's generated query builder types .eq()'s column argument per
  // table — since `table` here is a runtime union, TS can't narrow which
  // table's column set applies. `never` is the one type assignable to any
  // parameter type, so this cast is a deliberate, narrow escape hatch (not
  // a stand-in for real typing elsewhere) — the runtime value is always
  // exactly the correct column name for whichever table was actually passed.
  const idColumn = (table === 'dish_likes' ? 'dish_id' : 'category_id') as never;
  const { isRTL } = useI18n();
  const [liked, setLiked] = useState(initiallyLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  // Only resyncs when useMyLikes' own fetch actually resolves after this
  // component already mounted (the one real race: this row rendered before
  // that fetch returned) — never fights a diner's own optimistic toggle()
  // below, since initiallyLiked only changes when useMyLikes' Set itself is
  // replaced, which happens exactly once per MenuBrowser mount.
  useEffect(() => {
    // Resyncs only when useMyLikes' fetch actually resolves after mount —
    // intentionally not computed during render, since `liked` must keep a
    // diner's own optimistic toggle() between resyncs (see comment above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiked(initiallyLiked);
  }, [initiallyLiked]);

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
      hitSlop={hitSlop}
      className={showCount ? 'items-center rounded-full bg-white px-2.5 py-1.5' : 'items-center justify-center'}
      style={
        showCount
          ? {
              flexDirection: visualRowDirection(isRTL),
              // Real bug (2026-10-27): the 2026-09-14 "left/right auto-
              // mirrors" rule this cited (from BurgerSideMenu's older
              // X-badge fix) was never actually correct — plain left/right
              // are NOT I18n-aware in React Native, only flexDirection and
              // the logical start/end props are (see i18n.tsx's own
              // physicalReadingEnd for the real explanation). Computed
              // explicitly instead: lands on the physical left in Hebrew,
              // physical right in English, with no dependency on
              // I18nManager at all.
              position: 'absolute',
              top: 8,
              [physicalReadingEnd(isRTL)]: 8,
              gap: 5,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: 3,
            }
          : positionStyle
      }
    >
      {showCount && <Text className="text-sm font-semibold text-[#1B2430]">{count}</Text>}
      <Ionicons name={liked ? 'heart' : 'heart-outline'} size={iconSize} color={liked ? '#DC2626' : '#1B2430'} />
    </Pressable>
  );
}

function CategoryCard({
  category,
  dishes,
  onPress,
  t,
  isRTL,
  initiallyLiked,
}: {
  category: MenuCategory;
  dishes: Dish[];
  onPress: () => void;
  t: (key: TranslationKey) => string;
  isRTL: boolean;
  initiallyLiked: boolean;
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
        <LikeButton table="menu_category_likes" id={category.id} initialCount={category.likes_count} initiallyLiked={initiallyLiked} />
      </View>
      {/* pt-2 (not py-3) so the name sits close under the image, per
          feedback that it read as floating too far below it. Rating block
          moved beside the name (not a separate row above it) — right side
          (RTL-start) holds the name, left side holds stars + verified-
          review count, both at the top of the strip. The tighter side (not
          a symmetric px-3) so this block sits closer to the card's actual
          left edge in Hebrew, per feedback that it read as floating too far
          from it — the generous side keeps the name's own breathing room.
          Real bug (2026-10-27): this used to be paddingStart/paddingEnd,
          RN's logical props — both resolve through the same broken
          I18nManager.isRTL flag as flexDirection does, so the generous/
          tight sides landed backwards (title squeezed against the stars
          instead of having room). Computed explicitly instead, independent
          of that flag (see i18n.tsx's physicalReadingStart/End). */}
      <View className="pb-3 pt-2" style={physicalReadingStart(isRTL) === 'right' ? { paddingRight: 12, paddingLeft: 6 } : { paddingLeft: 12, paddingRight: 6 }}>
        <View className="items-start justify-between" style={{ flexDirection: visualRowDirection(isRTL) }}>
          {/* Real bug (2026-10-28): this Text is flex-1 (a wide box, not
              sized to its own content) with no explicit textAlign — RN's
              default 'auto' resolves through the same stuck
              I18nManager.isRTL flag as flexDirection does, not the actual
              language, so it rendered flush against whatever physical side
              'auto' happened to resolve to (the left, next to the stars)
              instead of the card's right edge. textAlign literal values are
              NOT I18n-mirrored (only 'auto' is), so physicalReadingStart
              gives a flag-independent, always-correct answer here, same as
              it does for absolute positioning. */}
          <Text className="flex-1 text-base font-bold" style={{ color: '#173A63', textAlign: physicalReadingStart(isRTL) }}>
            {category.name}
          </Text>
          {avgRating !== null && (
            <View
              className="items-center"
              style={{
                flexDirection: visualRowDirection(isRTL),
                gap: 4,
                ...(physicalReadingStart(isRTL) === 'right' ? { marginRight: 6 } : { marginLeft: 6 }),
              }}
            >
              <Ionicons name="trophy" size={13} color="#F5A623" />
              <StarRow value={avgRating} size={15} />
            </View>
          )}
        </View>
        {/* Review count moved down onto the same row as "ראו את כל התפריט"
            (was on the stars' row above) — same text-xs size as that link,
            opposite side of the same row via justify-between. */}
        <View className="mt-1.5 items-center justify-between" style={{ flexDirection: visualRowDirection(isRTL) }}>
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
  presenceCount,
  categoryOrdersToday,
  criticalStockStatus,
  vatRatePercent,
  initiallyLiked,
}: {
  dish: Dish;
  sizes: DishSizeOption[];
  onPress: () => void;
  t: (key: TranslationKey) => string;
  orderStats: DishOrderStats | undefined;
  presenceCount: number;
  categoryOrdersToday: number;
  criticalStockStatus: 'low' | 'out' | undefined;
  vatRatePercent: number | null;
  initiallyLiked: boolean;
}) {
  const image = dish.photo_urls[0];
  const { isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  // Score-derived (2026-09-24): dishes.is_special_value turned out to be a
  // dead column (documented as "staff-set", but grepping MenuManager.tsx
  // shows no admin UI ever sets it) — per the user's instruction this badge
  // (and the trophy added earlier) now share the same real, live signal.
  const isTopRated = (dish.guest_rating_score ?? 0) > 9;
  const isHighDemand = categoryOrdersToday > 0 && (orderStats?.count ?? 0) / categoryOrdersToday >= 0.25;
  const isLowStock = criticalStockStatus === 'low';
  const isSoldOut = criticalStockStatus === 'out';
  const activityLabel = orderActivityLabel(orderStats, t);
  const presenceLabel = presenceCount <= 0 ? null : presenceCount === 1 ? t('dishPresenceSingularLabel') : t('dishPresencePluralLabel').replace('{count}', String(presenceCount));

  // Tap-only, not swipe (2026-10-01, per explicit request): a horizontal
  // swipe across this card never leaves its own bounds, so RN's own
  // Pressable never cancels it as a drag (that cancellation is based on the
  // touch leaving the element's hit rect, not on how far it moved) — swiping
  // across the card was opening the dish detail screen exactly like a tap.
  // Recording the touch's start point and comparing it against the release
  // point lets onPress ignore anything that moved more than a few px, which
  // a real tap never does.
  const cardTouchStart = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_CANCEL_THRESHOLD = 12;

  function handleCardPressIn(e: GestureResponderEvent) {
    cardTouchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  }

  function handleCardPress(e: GestureResponderEvent) {
    const start = cardTouchStart.current;
    if (start) {
      const dx = Math.abs(e.nativeEvent.pageX - start.x);
      const dy = Math.abs(e.nativeEvent.pageY - start.y);
      if (dx > SWIPE_CANCEL_THRESHOLD || dy > SWIPE_CANCEL_THRESHOLD) return;
    }
    onPress();
  }

  // Long-press the photo for a larger preview (2026-10-01, per explicit
  // request) — closes the instant the long-press is released (onPressOut),
  // not on a second tap. This is its own nested Pressable, not part of the
  // card's own one above: RN's touch responder system hands an entire touch
  // sequence to whichever view claims it (the deepest one that can), so this
  // inner Pressable naturally intercepts the long-press on the photo without
  // also triggering the outer card's onPress for that same touch.
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);

  return (
    // Image first, content second: under this app's forced RTL, the first
    // flex-row child renders on the physical right (same convention already
    // proven in add-participants.tsx's contact rows — avatar first, name
    // second) — matching 7.1.1's layout (photo on the right, details on the
    // left), the reverse of what this row had before.
    // Separated card, not a connected flat-list row (2026-10-01, per
    // explicit request) — square corners (2026-10-01 follow-up: rounded
    // corners were clipping the price/button area, which sits close to the
    // card's bottom-left corner — squaring it off removes the clip instead
    // of chasing padding to dodge the curve).
    <>
    <Pressable
      onPressIn={handleCardPressIn}
      onPress={handleCardPress}
      className="mb-3 bg-white"
      style={{ flexDirection: rowDirection, gap: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
    >
      {/* Image stretched flush to the card's own edges (2026-10-01, per
          explicit request — "as it was before" the card padding started
          insetting it) — no padding/rounding of its own; the card's own
          overflow-hidden + rounded-xl already clips it to match. Only the
          text content half keeps its own inner padding below.
          2026-10-01 (two follow-up fixes for the long-press preview below):
          attempt 1 wrapped the Image in a Pressable with height:'100%' on
          the Image — a percentage height nested inside an ALSO-stretch-sized
          parent, which Yoga couldn't resolve and stretched the image across
          the whole screen. Attempt 2 kept width:120/alignSelf:'stretch' on
          the Image itself but inside an extra plain View wrapper — that
          wrapper defaults to a COLUMN flex container, and alignSelf:'stretch'
          only affects the CROSS axis (width in a column), so the Image got
          no height at all this time and disappeared entirely (both real-
          device feedback). Fixed for real: the width:120/alignSelf:'stretch'
          spec — the one that always worked — now lives on THIS View, a
          direct row child exactly like the Image used to be, so it resolves
          the same height as before through the ROW's own cross axis. The
          Image and the long-press Pressable are both absolutely inset to
          fill it (0,0,0,0), not percentage-sized, which is the one sizing
          mechanism that doesn't create the ambiguous-height chain above. */}
      {/* Width bumped 120→150 (2026-10-01, per explicit request — "too
          cropped and unclear") — this column stretches to the row's own
          height, which has grown a lot over this session (score/review line,
          VAT line, discount badge, etc.); against a typical landscape food
          photo, that made for an increasingly tall/narrow box that
          resizeMode="cover" had to crop and upscale aggressively to fill,
          losing detail. A wider box needs less of either. */}
      {image ? (
        <View style={{ width: 150, alignSelf: 'stretch', position: 'relative' }}>
          <Image source={{ uri: image }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" />
          {/* This overlay is the deepest view under a touch that starts on
              the photo, so it's the one that becomes the touch responder —
              the outer card's own onPress never fires for a touch that
              started here (2026-10-01, per explicit request/real-device
              feedback: a quick tap on the photo did nothing). Mirroring the
              same onPressIn/onPress pair the card uses elsewhere makes a
              quick tap on the photo behave identically to tapping anywhere
              else on the card; RN suppresses onPress once onLongPress has
              actually fired, so a long-press only opens the preview and
              never also navigates to the detail screen. */}
          <Pressable
            onPressIn={handleCardPressIn}
            onPress={handleCardPress}
            onLongPress={() => setImagePreviewVisible(true)}
            onPressOut={() => setImagePreviewVisible(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        </View>
      ) : (
        <View style={{ width: 150, alignSelf: 'stretch', backgroundColor: '#EFEBE2' }} />
      )}
      {/* Real bug (2026-10-28): `pe-4` is NativeWind's logical padding-end
          utility — it resolves through the same stuck I18nManager.isRTL
          flag as RN's own paddingStart/paddingEnd do (see i18n.tsx's own
          comment on those), not the actual language, so it was landing on
          the wrong physical side: the gap against the photo (right side,
          already has the row's own `gap: 10`) instead of the gap against
          the card's outer wall (physical left in Hebrew) — leaving every
          label in this column flush against that wall with no breathing
          room, looking clipped. Computed explicitly instead. */}
      <View
        className="flex-1 justify-center py-3"
        style={physicalReadingEnd(isRTL) === 'left' ? { paddingLeft: 16 } : { paddingRight: 16 }}
      >
        {/* Title row (2026-09-24): the score badge moved up here, to the
            far corner opposite the name — same justify-between pattern
            CategoryCard's own title row already uses for its trophy+stars
            corner element, just with the score badge as the corner element
            here instead. */}
        {/* Corner element switched to a like (heart) toggle (2026-10-01, per
            explicit request) — the score badge that used to live here moved
            down below the stars row instead, paired with the review count.
            Absolute positioning kept from the score-badge era: it removes
            the corner from layout flow, so the title's own height is the
            only thing anything below needs to sit tight against. `end: 0`
            is RN's own logical position property — physically the left edge
            under this app's forced RTL, same corner the score badge sat in.
            2026-10-01 (follow-up): top+bottom both 0 (instead of just top:0)
            stretches the absolute box to the title Text's own full height —
            1 or 2 lines — and the Pressable's own items-center/justify-center
            (see its non-count className branch) then centers the icon inside
            that box, so it lines up with the title regardless of whether the
            name wraps, rather than sitting pinned to the top edge.
            2026-10-01 (follow-up): sized up again (21→26) and given a wider
            hitSlop (8→14) per explicit request — needs to actually read as
            tappable and be comfortable to hit with a finger, not just a
            small decorative icon. `paddingEnd` on the title bumped to match
            the bigger icon so the two-line title text still can't run under
            it. */}
        {/* minHeight (2026-10-01, per explicit request — heart looked
            slightly clipped at its bottom edge): the box the heart is
            absolutely stretched into (top:0,bottom:0 below) is exactly as
            tall as the title's own single-line height, which can be a hair
            shorter than the 22px icon itself once centered inside it —
            minHeight guarantees enough room regardless of the title's own
            line height, for a one-line or a two-line name alike. */}
        <View style={{ position: 'relative', minHeight: 26 }}>
          {/* Sized up slightly (2026-10-01, per explicit request, gentle
              increase) — was text-base (16px). */}
          {/* Real bug (2026-10-27): paddingEnd and the LikeButton's own
              positionStyle below both used RN's logical `end` property,
              which resolves through the same broken I18nManager.isRTL flag
              as flexDirection does — computed explicitly through
              physicalReadingEnd instead (see i18n.tsx), independent of that
              flag. */}
          <Text
            className="text-[17px] font-semibold text-[#1B2430]"
            style={{
              textAlign: physicalReadingStart(isRTL),
              ...(physicalReadingEnd(isRTL) === 'left' ? { paddingLeft: 32 } : { paddingRight: 32 }),
            }}
            numberOfLines={2}
          >
            {dish.name}
          </Text>
          <LikeButton
            table="dish_likes"
            id={dish.id}
            initialCount={dish.likes_count}
            initiallyLiked={initiallyLiked}
            showCount={false}
            iconSize={22}
            hitSlop={14}
            positionStyle={{ position: 'absolute', top: 0, bottom: 0, [physicalReadingEnd(isRTL)]: 0 }}
          />
        </View>
        {/* Stars + trophy + Feedstars, tight under the title (2026-09-27) —
            now that the corner score badge is absolutely positioned (out of
            flow), this row's gap depends only on the title text's own
            height, so a small fixed margin is stable regardless of how tall
            the corner decoration is. Feedstars sits beside the stars, not on
            its own row. flex-wrap as a safety net only; at normal card
            widths this still fits on one line. */}
        {(dish.rating_count > 0 || dish.feedstars_eligible) && (
          <View className="flex-wrap items-center" style={{ flexDirection: rowDirection, gap: 4, marginTop: 2 }}>
            {/* Stars + trophy sized up slightly (2026-10-01, per explicit
                request, gentle increase) — was 12/13. */}
            {dish.rating_count > 0 && <StarRow value={dish.rating_avg ?? 0} size={14} />}
            {dish.rating_count > 0 && isTopRated && <Ionicons name="trophy" size={15} color="#F5A623" />}
            {dish.feedstars_eligible && (
              // Same "Genius"-style badge as the Web Admin's dish list (gold
              // background, white Baloo 2 wordmark, sparkles-outline icon).
              // Sized down slightly (2026-09-24): this row's height is set by
              // this badge (the tallest child), so trimming its own padding
              // is what actually pulls the whole row — and the title gap
              // above it — tighter, not the row's own marginTop/gap.
              <View className="items-center rounded" style={{ flexDirection: rowDirection, backgroundColor: '#F5A623', gap: 2, paddingHorizontal: 5.5, paddingVertical: 1.5 }}>
                <Ionicons name="sparkles-outline" size={8.5} color="#FFFFFF" />
                <Text style={{ fontFamily: 'Baloo2_700Bold', fontSize: 8.5, color: '#FFFFFF' }}>{t('dishFeedstarsBadge')}</Text>
              </View>
            )}
          </View>
        )}
        {/* Score badge + review count, moved down here below the stars row
            (2026-10-01, per explicit request) — previously an absolutely
            positioned corner element beside the title, now flowing inline
            with everything else. Score first in source order so RTL's flip
            (see the file's own "image first" convention above) puts it on
            the physical right, with the tier label and review count landing
            physically to its left, per the explicit request.
            2026-10-01 (follow-up): the tier label ("מעולה" etc.) pulled out
            of the badge itself (which now holds only the numeric score) and
            placed as its own text between the badge and the review count,
            sized/colored to match the review count exactly (same textMuted
            gray, same font size) rather than the badge's white/8px text —
            joined to the review count with a "·" separator. */}
        {dish.rating_count > 0 && (
          <View className="items-center" style={{ flexDirection: rowDirection, gap: 6, marginTop: 3 }}>
            {/* Score number sized up slightly (2026-10-01, gentle increase, per
                explicit request) — was text-xs (12px). */}
            <View className="items-center rounded px-1.5 py-0.5" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="text-[13px] font-bold text-white">{(dish.guest_rating_score ?? 0).toFixed(1)}</Text>
            </View>
            <Text className="text-[11px] font-medium" style={{ color: colors.textMuted }}>
              {t(ratingTierLabel(dish.guest_rating_score ?? 0, t))}
            </Text>
            {/* Separator dot given its own Text, bolder and darker than the
                muted review text around it (2026-10-01, per explicit
                request — "תדגיש יותר את הנקודה"), instead of sitting inline
                at the same weight/color as the review count. */}
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              ·
            </Text>
            <Text className="text-[11px]" style={{ color: colors.textMuted }}>
              {t('dishReviewCountLabel').replace('{count}', String(dish.rating_count))}
            </Text>
          </View>
        )}
        {/* Serving-size options (2026-09-24), per the mockup: only renders
            when the restaurant actually defined size options for this dish
            (`sizes` comes straight from dish_size_options — nothing shown
            for a dish with a single flat price). Each option's own `name`
            already carries its unit (e.g. "350 גרם"), so this just joins
            them with the mockup's "/" separator. */}
        {/* Real bug (2026-10-28): plain block Text, same textAlign:'auto'-
            depends-on-the-stuck-native-flag issue as CategoryCard's own
            title — it was rendering flush against this column's left edge
            (the box's own full-stretch width) instead of beside the title
            on the right. */}
        {sizes.length > 0 && (
          <Text className="mt-0.5 text-xs" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
            {sizes.map((s) => s.name).join(' / ')}
          </Text>
        )}
        {/* Real, live order-activity line (2026-09-24) — only ever renders
            when get_dish_order_stats() actually returned data for today;
            never a fixed/fabricated urgency claim (see the migration's own
            comment for why this had to be an RPC in the first place). */}
        {/* Sized down slightly (2026-10-01, per explicit request) — the
            "with last-order-time" variant's longer text was wrapping to a
            second line at the card's width.
            2026-10-01 (follow-up): a fixed font size still truncated with an
            ellipsis once the minutes count reached double digits (a longer
            string than what the size was tuned against) — adjustsFontSizeToFit
            lets RN shrink the text just enough to keep fitting on its one
            line instead of cutting it off, for any digit count. */}
        {activityLabel && (
          <Text
            className="mt-1 text-[10.5px] font-medium"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{ color: colors.bottleGreen, textAlign: physicalReadingStart(isRTL) }}
          >
            {activityLabel}
          </Text>
        )}
        {/* Live "viewing right now" line (2026-09-29) — real-time Presence
            count, not a cumulative daily total (see useDishPresence). Same
            real-data-only rule as the order-activity line above: only ever
            renders when someone is actually on this dish's detail screen at
            this instant. Deliberately muted (not bottleGreen): a view is a
            softer signal than an actual order, and the two shouldn't read as
            the same weight of claim. */}
        {/* Sized down slightly (2026-10-01, per explicit request, gentle
            decrease) — was text-[12px]. */}
        {presenceLabel && (
          <Text className="mt-0.5 text-[11px] font-medium" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
            {presenceLabel}
          </Text>
        )}
        {/* High demand (≥25% of the category's orders today) — real-data
            bullet, independently gated on its own live condition. "כמעט
            אזל" moved down next to the price (2026-09-27, per explicit
            request), no longer sharing this row. */}
        {/* Real bug (2026-10-28): this used to be a literal className
            "flex-row" with a single child — harmless for child ORDER since
            there's only one, but the single badge's own position within
            this container (which stretches to the DishRow column's full
            width) comes from justifyContent's default flex-start, which IS
            a main-axis/direction-aware position — so under the stuck
            I18nManager.isRTL flag it kept landing flush on the physical
            left regardless of language (per real-device feedback, it
            appeared on the left instead of the right). Needs rowDirection
            the same as any other flexDirection in this file. */}
        {isHighDemand && (
          <View className="mt-1 flex-wrap items-center" style={{ flexDirection: rowDirection, gap: 4 }}>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.darkRed }}>
              <Text className="text-[10px] font-semibold text-white">{t('dishHighDemandBadge')}</Text>
            </View>
          </View>
        )}
        {/* Top-rated value badge — always its own row below "ביקוש גבוה"
            (2026-09-27, per explicit request), not sharing a row/wrap with
            it. Same single-child positioning bug as isHighDemand above,
            fixed the same way. */}
        {isTopRated && (
          <View className="mt-1 items-center" style={{ flexDirection: rowDirection, gap: 4 }}>
            <View className="rounded px-2.5 py-1" style={{ borderWidth: 1.5, borderColor: colors.valueOrange, backgroundColor: '#FFFFFF' }}>
              <Text className="text-[11px] font-semibold" style={{ color: colors.valueOrange }}>
                {t('dishBadgeSpecialValue')}
              </Text>
            </View>
          </View>
        )}
        {/* Price block anchored to the physical left in Hebrew (per explicit
            request).
            Real bug (2026-10-28): this used to be a literal
            alignSelf: 'flex-end', assuming it would resolve through
            I18nManager the way a flex-row's child order does — which is
            true in principle (a column's cross axis is horizontal, so it
            genuinely is direction-aware), but it goes through the exact
            same stuck I18nManager.isRTL flag as flexDirection does, so it's
            just as unreliable. visualColumnAlign counteracts that flag the
            same way visualRowDirection does for flexDirection.
            2026-10-01 (reworked): "כמעט אזל" used to live here, beside the
            whole PriceRow column — which put it beside the VAT label's own
            (much wider) line whenever that was the widest line in the
            column, visibly detaching it from the price and overflowing the
            row (real-device feedback, smoked entrecote steak). It's now
            entirely PriceRow's own responsibility, rendered inline next to
            whichever specific line it belongs beside — see PriceRow's
            almostOutLabel prop. */}
        <View className="mt-1.5" style={{ alignSelf: visualColumnAlign(physicalReadingEnd(isRTL)) }}>
          {!isSoldOut && (
            <PriceRow dish={dish} sizes={sizes} t={t} vatRatePercent={vatRatePercent} almostOutLabel={isLowStock ? t('dishAlmostOutBadge') : null} />
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
        {/* Language-dependent, not a fixed physical side (2026-10-28,
            correcting the previous fix) — anchored to the side AWAY from
            the photo (physicalReadingEnd: physical left in Hebrew, physical
            right in English), the same side every other "trailing"
            decoration in this file uses, so it mirrors correctly in
            English the same way the image/content order itself does (see
            this row's own "Image first, content second" comment above). */}
        <Pressable
          onPress={isSoldOut ? undefined : onPress}
          disabled={isSoldOut}
          className="mt-1.5 items-center justify-center rounded-lg"
          style={{
            backgroundColor: isSoldOut ? '#9CA3AF' : colors.royalBlue,
            paddingVertical: 8,
            paddingHorizontal: 28,
            alignSelf: visualColumnAlign(physicalReadingEnd(isRTL)),
          }}
        >
          <Text className="text-sm font-semibold text-white">{isSoldOut ? t('dishSoldOutButton') : t('dishOrderNowButton')}</Text>
        </Pressable>
      </View>
    </Pressable>
    {/* Full-screen long-press preview (2026-10-01, per explicit request) —
        same photo, shown large with resizeMode="contain" so none of it is
        cropped the way the 120px cover thumbnail is. transparent+dark
        backdrop, no close button: it's only ever open while the finger is
        still down (onPressOut above closes it), so there's nothing else to
        dismiss it with. */}
    {image && (
      <Modal visible={imagePreviewVisible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }}>
          <Image source={{ uri: image }} style={{ width: '100%', height: '70%' }} resizeMode="contain" />
        </View>
      </Modal>
    )}
    </>
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

// Full-screen photo viewer for every photo of a dish (2026-10-06, per explicit
// request) — opened by tapping the photo in the dish detail sheet, swipeable
// left/right. Opens on the photo the diner was already looking at.
function DishPhotoGallery({
  visible,
  photos,
  initialIndex,
  onClose,
}: {
  visible: boolean;
  photos: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { isRTL } = useI18n();
  const screenWidth = Dimensions.get('window').width;
  const count = photos.length;
  const [index, setIndex] = useState(initialIndex);
  useEffect(() => {
    // Resets to the tapped photo each time the gallery reopens — not
    // computed during render since `index` must still track swipes while open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (count - 1 - initialIndex) * screenWidth, y: 0 }}
          onMomentumScrollEnd={(e) => setIndex(count - 1 - Math.round(e.nativeEvent.contentOffset.x / screenWidth))}
          style={{ flexGrow: 0, direction: 'ltr' }}
        >
          {[...photos].reverse().map((uri) => (
            <View key={uri} style={{ width: screenWidth, justifyContent: 'center' }}>
              <Image source={{ uri }} style={{ width: screenWidth, height: screenWidth * 1.1 }} resizeMode="contain" />
            </View>
          ))}
        </ScrollView>
        <Text className="mt-4 text-center text-sm font-semibold text-white">{`⁦${index + 1}/${count}⁩`}</Text>
        <Pressable
          onPress={onClose}
          className="absolute items-center justify-center rounded-full bg-white/20"
          style={{ top: 48, [physicalReadingEnd(isRTL)]: 16, width: 40, height: 40 }}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

// The assembled result of DishDetailModal's own selection state, shared by
// every save path (cartStore addItem, or OrderTracker's onSaveOverride) —
// same field set CartLineItem needs, minus its own cart-only `id`.
export interface DishSelectionPayload {
  dishId: string;
  dishName: string;
  quantity: number;
  sizeOptionId: string | null;
  sizeOptionName: string | null;
  modifierSelections: CartModifierSelection[];
  modifierSummary: string;
  unitPrice: number;
}

export function DishDetailModal({
  dish,
  sizes,
  groups,
  optionsByGroup,
  variantsByOption,
  soldOut,
  missingIngredientNames,
  unavailableOptionIds,
  editingItem,
  onSaveOverride,
  onClose,
  onAdded,
  trackDish,
  untrackDish,
}: {
  dish: Dish;
  sizes: DishSizeOption[];
  groups: DishModifierGroup[];
  optionsByGroup: Map<string, DishModifierOption[]>;
  variantsByOption: Map<string, ModifierOptionServingVariant[]>;
  soldOut: boolean;
  missingIngredientNames: string[];
  unavailableOptionIds: Set<string>;
  // Set only when opened via the cart's edit icon, or (2026-10-11, user
  // request) OrderTracker's "בצעו שינויים במנה" for an already-placed item
  // within its 5-minute edit window — pre-fills every selection below from
  // this existing line instead of starting neutral. When onSaveOverride is
  // not given, handleAdd() replaces it in the cart (remove + re-add); when
  // it is, only `id` is read here for the pre-fill — the save itself goes
  // through onSaveOverride instead (see its own comment).
  editingItem: CartLineItem | null;
  // Set only by OrderTracker's live-order-item edit flow (2026-10-11, user
  // request: "אופן הפעולות לשינויים זהה לתהליך של ביצוע שינויים לפני שליחה
  // למטבח" — reuse this exact screen, not a parallel one). When present,
  // handleAdd() calls this with the assembled selection instead of touching
  // the cart store at all — the caller owns what "save" means (a
  // update-order-item PATCH, not a cartStore mutation) and decides when to
  // close the modal (only after that call actually succeeds).
  onSaveOverride?: (payload: DishSelectionPayload) => void;
  onClose: () => void;
  onAdded: () => void;
  // Owned by useDishPresence in the parent (2026-10-01) — this modal no
  // longer opens its own RealtimeChannel for presence (see that hook's own
  // comment for the real crash this used to cause by sharing one topic
  // across two independently-managed channel instances).
  trackDish: (dishId: string) => void;
  untrackDish: () => void;
}) {
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  // No pre-selected size, ever (2026-09-24, per the user's explicit
  // request) — every size is presented neutrally and the diner must
  // actively pick one; handleAdd() below blocks adding to the order until
  // they do, the same way a required modifier group already does. The one
  // deliberate exception (2026-10-11, user request): editing an existing
  // cart line pre-fills its already-made size choice, since the whole
  // point of reopening here is to show what's already selected, not to
  // force the diner through the same required choice again.
  const [sizeOptionId, setSizeOptionId] = useState<string | null>(() => editingItem?.sizeOptionId ?? null);
  const [selections, setSelections] = useState<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    if (!editingItem) return map;
    for (const sel of editingItem.modifierSelections) {
      for (const group of groups) {
        if ((optionsByGroup.get(group.id) ?? []).some((o) => o.id === sel.modifierOptionId)) {
          const set = map.get(group.id) ?? new Set<string>();
          set.add(sel.modifierOptionId);
          map.set(group.id, set);
          break;
        }
      }
    }
    return map;
  });
  // Bottle/draft(+size) serving-format choice (2026-09-29, refined per
  // explicit follow-up into a real two-axis choice): optionId -> chosen
  // container type, only asked when an option actually offers BOTH (a
  // single-container option never shows this step at all — see
  // resolvedVariant below). optionId -> chosen size variantId within
  // whichever container ends up in play — only asked when that container has
  // more than one size defined. Both cleared for an option the diner just
  // deselected, in toggleOption below, so a stale pick from an earlier
  // selection can't silently ride along. Pre-filled from editingItem's own
  // stored servingVariantId the same way (2026-10-11, user request).
  const [containerTypeSelections, setContainerTypeSelections] = useState<Map<string, 'bottle' | 'draft'>>(() => {
    const map = new Map<string, 'bottle' | 'draft'>();
    if (!editingItem) return map;
    for (const sel of editingItem.modifierSelections) {
      if (!sel.servingVariantId) continue;
      const variant = (variantsByOption.get(sel.modifierOptionId) ?? []).find((v) => v.id === sel.servingVariantId);
      if (variant?.container_type === 'bottle' || variant?.container_type === 'draft') {
        map.set(sel.modifierOptionId, variant.container_type);
      }
    }
    return map;
  });
  const [variantSelections, setVariantSelections] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!editingItem) return map;
    for (const sel of editingItem.modifierSelections) {
      if (sel.servingVariantId) map.set(sel.modifierOptionId, sel.servingVariantId);
    }
    return map;
  });

  // Resolves an option's final chosen variant — auto-resolving every step
  // that isn't a real choice (one container type only, or one size only
  // within the container in play), per the exact rules requested: a
  // bottle-only option with one size shows nothing at all; a
  // bottle-and-draft option always asks container type first; a chosen
  // container with 2+ sizes always asks size. Returns undefined only when a
  // real, still-unmade choice blocks resolution (used by canAdd/handleAdd to
  // require it).
  function resolveVariant(optionId: string): { variant: ModifierOptionServingVariant | undefined; needsContainerChoice: boolean; needsSizeChoice: boolean } {
    const variants = variantsByOption.get(optionId) ?? [];
    const bottleVariants = variants.filter((v) => v.container_type === 'bottle');
    const draftVariants = variants.filter((v) => v.container_type === 'draft');
    const hasBothTypes = bottleVariants.length > 0 && draftVariants.length > 0;
    const chosenType = hasBothTypes ? containerTypeSelections.get(optionId) : bottleVariants.length > 0 ? 'bottle' : draftVariants.length > 0 ? 'draft' : undefined;
    if (!chosenType) return { variant: undefined, needsContainerChoice: hasBothTypes, needsSizeChoice: false };
    const sizesForType = chosenType === 'bottle' ? bottleVariants : draftVariants;
    if (sizesForType.length === 1) return { variant: sizesForType[0], needsContainerChoice: false, needsSizeChoice: false };
    const chosenVariantId = variantSelections.get(optionId);
    const variant = chosenVariantId ? sizesForType.find((v) => v.id === chosenVariantId) : undefined;
    // Bug found 2026-09-30: this used to be unconditionally
    // `sizesForType.length > 1`, meaning ANY multi-size format permanently
    // read as "still needs a choice" even after one was actually picked —
    // "הוסיפו להזמנה" stayed disabled forever once a draft/bottle with 2+
    // sizes was selected, no matter what the diner did next.
    return { variant, needsContainerChoice: false, needsSizeChoice: sizesForType.length > 1 && !variant };
  }
  const [quantity, setQuantity] = useState(() => editingItem?.quantity ?? 1);
  const [validationErrorKey, setValidationErrorKey] = useState<TranslationKey | null>(null);
  const [galleryVisible, setGalleryVisible] = useState(false);
  // Same score-derived signal as DishRow's own trophy/badge (2026-09-24).
  const isTopRated = (dish.guest_rating_score ?? 0) > 9;
  const { reviews: dishReviews, positiveReviewCount } = useDishReviews(dish.id);
  // Log a real "view" of this dish's detail screen (2026-09-29) — fires once
  // per modal mount (this component unmounts/remounts on every open, see
  // MenuBrowser's `{selectedDish && <DishDetailModal .../>}`, so effect deps
  // don't need dish.id to re-trigger on reopen). Deduped server-side by the
  // dish_views primary key (participant_id, dish_id) — ignoreDuplicates means
  // reopening the same dish again this table visit is a harmless no-op, not
  // an error, and ordering doesn't retry on failure (a missed view log is not
  // worth a broken order flow over).
  const participantId = useTableSessionStore((s) => s.participantId);
  useEffect(() => {
    if (!participantId) return;
    // Logged (not swallowed) so a future RLS/grant regression here surfaces
    // in the console instead of silently never counting a single view again
    // — exactly what happened 2026-09-29: a missing SELECT policy on
    // dish_views made every one of these upserts fail with nothing visible
    // anywhere until a real device test caught the bullet just never showing.
    supabase
      .from('dish_views')
      .upsert({ participant_id: participantId, dish_id: dish.id }, { onConflict: 'participant_id,dish_id', ignoreDuplicates: true })
      .then(({ error }) => {
        if (error) console.warn('dish_views upsert failed', error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Live presence: tag this diner as "looking at this dish right now" on the
  // restaurant's shared presence channel — owned entirely by useDishPresence
  // in MenuBrowser (2026-10-01 rewrite; see that hook's own comment for why
  // this modal used to open a second channel on the same topic and the real
  // crash that caused). Untracking on unmount is what makes this accurate:
  // closing the modal, backgrounding the app, or losing connection all drop
  // this diner from the count with no explicit "I'm leaving" call needed.
  useEffect(() => {
    trackDish(dish.id);
    return () => untrackDish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dish.id]);

  function toggleOption(group: DishModifierGroup, optionId: string) {
    if (unavailableOptionIds.has(optionId)) return;
    const option = (optionsByGroup.get(group.id) ?? []).find((o) => o.id === optionId);
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(group.id) ?? []);
      let deselected: string | null = null;
      if (group.selection_type === 'single') {
        const previouslySelected = [...current][0];
        // Re-tapping an already-chosen option that carries a real added
        // cost (e.g. a drink add-on priced via its own serving variant —
        // 1/3 ליטר Weihenstephan at ₪34 — the option row itself is always
        // ₪0, the price lives on the resolved variant) clears the group
        // back to "nothing chosen" instead of being a no-op (2026-10-11,
        // user request: only a priced tag can be undone this way — a free
        // choice, or any choice in a group that must always have
        // something selected, stays sticky, same as before).
        const { variant } = resolveVariant(optionId);
        const effectivePrice = variant ? variant.price_delta : (option?.price_delta ?? 0);
        if (previouslySelected === optionId && effectivePrice > 0) {
          next.set(group.id, new Set());
          deselected = optionId;
        } else {
          if (previouslySelected && previouslySelected !== optionId) deselected = previouslySelected;
          next.set(group.id, new Set([optionId]));
        }
      } else if (current.has(optionId)) {
        current.delete(optionId);
        next.set(group.id, current);
        deselected = optionId;
      } else {
        current.add(optionId);
        next.set(group.id, current);
      }
      if (deselected) {
        setVariantSelections((v) => {
          if (!v.has(deselected!)) return v;
          const nextV = new Map(v);
          nextV.delete(deselected!);
          return nextV;
        });
        setContainerTypeSelections((c) => {
          if (!c.has(deselected!)) return c;
          const nextC = new Map(c);
          nextC.delete(deselected!);
          return nextC;
        });
      }
      return next;
    });
  }

  const unitPrice = useMemo(() => {
    const chosenSize = sizeOptionId ? (sizes.find((s) => s.id === sizeOptionId) ?? null) : null;
    // Real bug fix (2026-10-11, user report): a dish WITH size options has
    // no real base price until one is actually chosen — dish.price only
    // applies to a dish with no sizes at all (same rule handleAdd's own
    // `sizes.length > 0 && !sizeOptionId` validation already enforces).
    // Falling back to dish.price unconditionally made the button's price
    // silently include the dish's own flat price before any size was
    // picked — invisible as long as size was chosen first (chosenSize then
    // overrides it immediately), but very visible when a diner picked
    // modifiers before size: every modifier stacked on top of that wrong
    // base the whole time.
    const base = chosenSize ? chosenSize.price : sizes.length > 0 ? 0 : dish.price;
    // Discount applies to the dish's own base price component only, never to
    // modifiers — same split place_order_transaction itself makes server-
    // side (see resolveDishDiscountRaw's own comment). Rounded here (unlike
    // PriceRow, which also needs the raw value for its badge's percent math).
    const discountedBase = Math.round(resolveDishDiscountRaw(dish, base, chosenSize));
    let modifiersTotal = 0;
    for (const group of groups) {
      const selected = selections.get(group.id) ?? new Set();
      for (const optionId of selected) {
        const option = (optionsByGroup.get(group.id) ?? []).find((o) => o.id === optionId);
        if (!option) continue;
        // A chosen serving format's own price REPLACES the option's own
        // price_delta entirely (never added to it) — same "sizes replace the
        // dish's own flat price" convention dish_size_options already uses.
        const { variant } = resolveVariant(optionId);
        modifiersTotal += variant ? variant.price_delta : option.price_delta;
      }
    }
    return discountedBase + modifiersTotal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeOptionId, selections, containerTypeSelections, variantSelections, groups, optionsByGroup, variantsByOption, sizes, dish]);

  // Order button disabled up front (2026-09-24, per the user's explicit
  // request) rather than only validating on press — a diner sees at a
  // glance that a required choice is still missing, instead of tapping a
  // live-looking button and getting an error modal back. Extended
  // 2026-09-29: a selected option that offers a serving-format choice needs
  // that choice fully resolved too (container type and/or size, whichever is
  // still a real choice), same required-ness as a required modifier group.
  const allSelectedOptionIds = [...selections.values()].flatMap((s) => [...s]);
  const canAdd =
    !soldOut &&
    (sizes.length === 0 || sizeOptionId !== null) &&
    groups.filter((g) => g.is_required).every((g) => (selections.get(g.id)?.size ?? 0) > 0) &&
    allSelectedOptionIds.every((optionId) => {
      const { variant, needsContainerChoice, needsSizeChoice } = resolveVariant(optionId);
      return !needsContainerChoice && !needsSizeChoice && ((variantsByOption.get(optionId) ?? []).length === 0 || variant !== undefined);
    });

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
    const allOptionIds = allSelectedOptionIds;
    if (
      allOptionIds.some((id) => {
        const { variant, needsContainerChoice, needsSizeChoice } = resolveVariant(id);
        return needsContainerChoice || needsSizeChoice || ((variantsByOption.get(id) ?? []).length > 0 && !variant);
      })
    ) {
      setValidationErrorKey('missingRequiredServingVariantMessage');
      return;
    }
    const summary = allOptionIds
      .map((id) => {
        for (const opts of optionsByGroup.values()) {
          const found = opts.find((o) => o.id === id);
          if (found) {
            const { variant } = resolveVariant(id);
            return variant ? `${found.name} (${variant.name})` : found.name;
          }
        }
        return null;
      })
      .filter((n): n is string => n !== null)
      .join(', ');

    const payload: DishSelectionPayload = {
      dishId: dish.id,
      dishName: dish.name,
      quantity,
      sizeOptionId,
      sizeOptionName: sizeOptionId ? (sizes.find((s) => s.id === sizeOptionId)?.name ?? null) : null,
      modifierSelections: allOptionIds.map((id) => ({ modifierOptionId: id, servingVariantId: resolveVariant(id).variant?.id ?? null })),
      modifierSummary: summary,
      unitPrice,
    };

    // A live, already-placed order item (OrderTracker) — the caller owns
    // the save (a server PATCH, not a cart mutation) and closes the modal
    // itself only once that actually succeeds, so this never calls
    // onAdded() on its own.
    if (onSaveOverride) {
      onSaveOverride(payload);
      return;
    }

    // Replace, not append, when editing an existing cart line (2026-10-11,
    // user request) — remove the original line first; addItem always mints
    // a fresh id anyway, so this is equivalent to an in-place update from
    // the diner's point of view.
    if (editingItem) removeItem(editingItem.id);
    addItem(payload);
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
              <View className="items-start justify-between px-4 pt-3" style={{ flexDirection: rowDirection }}>
                {/* Real bug (2026-10-28): same flex-1-with-no-explicit-
                    textAlign issue as CategoryCard's own title — see that
                    fix's comment. */}
                <Text className="flex-1 text-xl font-bold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {dish.name}
                </Text>
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
                <View className="flex-wrap items-start px-4" style={{ flexDirection: rowDirection, gap: 6, marginTop: 6 }}>
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
                    <View className="items-center rounded" style={{ flexDirection: rowDirection, backgroundColor: '#F5A623', gap: 2, paddingHorizontal: 5.5, paddingVertical: 1.5 }}>
                      <Ionicons name="sparkles-outline" size={11} color="#FFFFFF" />
                      <Text style={{ fontFamily: 'Baloo2_700Bold', fontSize: 11, color: '#FFFFFF' }}>{t('dishFeedstarsBadge')}</Text>
                    </View>
                  )}
                </View>
              )}
              {dish.photo_urls[0] && (
                <Pressable onPress={() => setGalleryVisible(true)} style={{ marginTop: 12 }}>
                  <Image source={{ uri: dish.photo_urls[0] }} style={{ width: '100%', height: 180 }} />
                  {dish.photo_urls.length > 1 && (
                    <View
                      className="absolute rounded-full px-2 py-0.5"
                      style={{ bottom: 8, [physicalReadingEnd(isRTL)]: 8, backgroundColor: 'rgba(0,0,0,0.55)' }}
                    >
                      <Text className="text-xs font-semibold text-white">{` 1/${dish.photo_urls.length}⁩`}</Text>
                    </View>
                  )}
                </Pressable>
              )}
              {/* Real bug (2026-10-28): plain full-width Texts, same
                  textAlign:'auto'-depends-on-the-stuck-native-flag issue as
                  CategoryCard's own title. */}
              <Text className="px-4 pb-1 pt-3 text-sm font-semibold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                {t('dishDescriptionTitle')}
              </Text>
              <Text className="px-4 pb-3 text-sm leading-5 text-[#6E6A61]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                {dish.description || t('dishDescriptionEmpty')}
              </Text>
              {/* Verified-diner reviews (2026-09-24, per the user's explicit
                  request and mockup) — real published reviews only (see
                  useDishReviews above for the full RLS/moderation reasoning),
                  never shown if there's no real data. positiveReviewCount can
                  be > 0 with zero cards below it (reviews that rated the
                  dish well but left no comment) — that's still a real signal
                  worth showing on its own. */}
              {positiveReviewCount > 0 && (
                <View className="px-4 pb-3" style={{ gap: 8 }}>
                  <View className="items-center" style={{ flexDirection: rowDirection, gap: 4 }}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                    <Text className="text-xs font-medium" style={{ color: colors.success }}>
                      {t('dishReviewsPositiveSummary').replace('{count}', String(positiveReviewCount))}
                    </Text>
                  </View>
                  {dishReviews.map((review) => (
                    <View key={review.id} className="rounded-lg p-2" style={{ backgroundColor: colors.background, gap: 4 }}>
                      <View className="items-center" style={{ flexDirection: rowDirection, gap: 6 }}>
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
                      {/* Real bug (2026-10-28): plain full-width Text, same
                          textAlign:'auto' issue as the description above. */}
                      <Text className="text-xs leading-5" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
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
                <View className="mx-4 mb-3 items-start rounded-lg p-2" style={{ flexDirection: rowDirection, gap: 6, backgroundColor: colors.background }}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                  <Text className="flex-1 text-xs" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
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
                {/* Real bug (2026-10-28): plain full-width Text, same
                    textAlign:'auto' issue as CategoryCard's own title. */}
                <Text className="mb-2 text-sm font-semibold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                  {t('dishSizeSectionTitle')}
                </Text>
                {/* Blue outline for every selectable tag, filled blue once
                    picked (2026-09-24, per the user's explicit design
                    request) — was a neutral gray border/dark text by
                    default before. */}
                <View className="flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
                  {sizes.map((size) => {
                    // Per-size discount shown directly on its own tag
                    // (2026-10-01, per explicit request) — picking it already
                    // charged the discounted price correctly (unitPrice/
                    // resolveDishDiscountRaw), but the tag itself still showed
                    // the raw size.price with no visual indication, so a
                    // diner had no way to tell a discount applied before
                    // picking. Same strikethrough-original/discounted-price
                    // convention as the card's own PriceRow.
                    const sizeHasDiscount = hasAnyDishDiscount(dish, size);
                    const sizeSelected = sizeOptionId === size.id;
                    const selectedTextColor = sizeSelected ? '#FFFFFF' : colors.royalBlue;
                    const discountedSizePrice = sizeHasDiscount ? Math.round(resolveDishDiscountRaw(dish, size.price, size)) : size.price;
                    return (
                      <Pressable
                        key={size.id}
                        onPress={() => setSizeOptionId(size.id)}
                        className="rounded-lg border px-3 py-2"
                        style={{ borderColor: colors.royalBlue, backgroundColor: sizeSelected ? colors.royalBlue : '#FFFFFF' }}
                      >
                        <Text className="text-sm font-medium">
                          <Text style={{ color: selectedTextColor }}>{size.name} · </Text>
                          {/* Shrunk and de-emphasized relative to the
                              discounted price beside it (2026-10-01, per
                              explicit request) — was the same size/weight as
                              everything else in the tag, competing with the
                              actual price instead of reading as secondary. */}
                          {sizeHasDiscount && (
                            <Text className="text-xs" style={{ color: colors.originalPriceRed, textDecorationLine: 'line-through' }}>
                              ₪{size.price}{' '}
                            </Text>
                          )}
                          <Text className="text-base font-bold" style={{ color: selectedTextColor }}>
                            ₪{discountedSizePrice}
                          </Text>
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {groups.map((group) => {
              const isAddonGroup = group.name === ADDON_GROUP_NAME;
              const isDonenessGroup = group.name === DONENESS_GROUP_NAME;
              return (
                <View key={group.id} className="mt-4 rounded-xl bg-white p-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View className="items-center" style={{ flexDirection: rowDirection, gap: 6 }}>
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
                  {/* Real bug (2026-10-28, per explicit request — e.g. a
                      single drink option like Weihenstephan landing on the
                      left instead of the right): rowDirection correctly
                      orders the tiles RELATIVE to each other, but a
                      horizontal ScrollView's content box is sized to its
                      own content by default (not the viewport) — when there
                      are too few tiles to fill the width, that narrow box
                      still has to sit SOMEWHERE within the viewport, and
                      with no flexGrow it only ever takes the smallest size
                      it can, leaving the extra space on whichever side
                      happens to be "after" it. flexGrow: 1 makes the content
                      box always at least fill the viewport, so justifyContent
                      (default flex-start, already the correct physical side
                      thanks to rowDirection) actually has room to anchor the
                      tiles against — harmless once there are enough tiles to
                      overflow and scroll, since flexGrow never shrinks
                      content narrower than it needs to be. */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="mt-2"
                    contentContainerStyle={{
                      flexDirection: rowDirection,
                      alignItems: 'flex-start',
                      flexGrow: 1,
                      gap: 10,
                      ...(physicalReadingEnd(isRTL) === 'left' ? { paddingLeft: 4 } : { paddingRight: 4 }),
                    }}
                  >
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
                  {/* Serving-format sub-picker (2026-09-29, refined per
                      explicit follow-up into a real two-axis choice) — only
                      ever shows a step that's a REAL choice: container type
                      only asked when the option offers both bottle and
                      draft; size only asked when the container in play (the
                      only one defined, or the one just chosen) has more than
                      one. An option with exactly one container and one size
                      shows nothing at all, per the exact rule requested. */}
                  {[...(selections.get(group.id) ?? new Set<string>())].map((optionId) => {
                    const variants = variantsByOption.get(optionId) ?? [];
                    if (variants.length === 0) return null;
                    const option = (optionsByGroup.get(group.id) ?? []).find((o) => o.id === optionId);
                    const bottleVariants = variants.filter((v) => v.container_type === 'bottle');
                    const draftVariants = variants.filter((v) => v.container_type === 'draft');
                    const hasBothTypes = bottleVariants.length > 0 && draftVariants.length > 0;
                    const chosenType = hasBothTypes ? containerTypeSelections.get(optionId) : bottleVariants.length > 0 ? 'bottle' : 'draft';
                    const sizesForType = chosenType === 'bottle' ? bottleVariants : chosenType === 'draft' ? draftVariants : [];
                    const chosenVariantId = sizesForType.length === 1 ? sizesForType[0]!.id : variantSelections.get(optionId);
                    // Fully auto-resolved (one container, one size) shows no
                    // interactive choice per the exact rule requested — but
                    // per the follow-up complaint, the diner still can't
                    // otherwise tell bottle from draft anywhere, so this
                    // stays as a plain info line instead of vanishing
                    // entirely.
                    if (!hasBothTypes && sizesForType.length <= 1) {
                      const only = sizesForType[0];
                      if (!only) return null;
                      return (
                        <Text key={optionId} className="mt-1.5 text-xs" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                          {t('dishServingResolvedPrefix').replace('{option}', option?.name ?? '')}
                          <Text className="font-bold" style={{ color: colors.ink }}>
                            {t(only.container_type === 'bottle' ? 'dishServingResolvedBoldBottle' : 'dishServingResolvedBoldDraft')}
                          </Text>
                          {t('dishServingResolvedSuffix').replace('{size}', only.name)}
                        </Text>
                      );
                    }
                    return (
                      <View key={optionId} className="mt-2">
                        {hasBothTypes && (
                          <>
                            <Text className="text-xs font-medium" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                              {t('dishServingContainerSectionTitle').replace('{option}', option?.name ?? '')}
                            </Text>
                            <View className="mt-1.5 flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
                              {(['bottle', 'draft'] as const).map((type) => (
                                <Pressable
                                  key={type}
                                  onPress={() => {
                                    setContainerTypeSelections((prev) => new Map(prev).set(optionId, type));
                                    setVariantSelections((prev) => {
                                      if (!prev.has(optionId)) return prev;
                                      const next = new Map(prev);
                                      next.delete(optionId);
                                      return next;
                                    });
                                  }}
                                  className="rounded-lg border px-3 py-2"
                                  style={{ borderColor: colors.royalBlue, backgroundColor: chosenType === type ? colors.royalBlue : '#FFFFFF' }}
                                >
                                  <Text style={{ color: chosenType === type ? '#FFFFFF' : colors.royalBlue }} className="text-sm font-medium">
                                    {t(type === 'bottle' ? 'dishServingContainerBottleLabel' : 'dishServingContainerDraftLabel')}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </>
                        )}
                        {chosenType && sizesForType.length > 1 && (
                          <>
                            {/* Container type named in the title even when
                                it was never an interactive choice (per the
                                follow-up complaint: a size-only picker with
                                no type step gave the diner zero way to know
                                whether "חצי"/"שליש" meant bottle or draft).
                                Bottle and draft get genuinely different
                                phrasing (2026-09-29, per explicit correction)
                                — a bottle is never "poured" — and the bold
                                segment is the FULL attached word ("מהחבית",
                                not just "חבית"), per the explicit request to
                                emphasize every letter fused to it. */}
                            <Text className="mt-2 text-xs font-medium" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                              {t(chosenType === 'bottle' ? 'dishServingSizeTitlePrefixBottle' : 'dishServingSizeTitlePrefixDraft')}
                              <Text className="font-bold" style={{ color: colors.ink }}>
                                {t(chosenType === 'bottle' ? 'dishServingSizeTitleBoldBottle' : 'dishServingSizeTitleBoldDraft')}
                              </Text>
                              {t(chosenType === 'bottle' ? 'dishServingSizeTitleSuffixBottle' : 'dishServingSizeTitleSuffixDraft').replace('{option}', option?.name ?? '')}
                            </Text>
                            <View className="mt-1.5 flex-wrap" style={{ flexDirection: rowDirection, gap: 8 }}>
                              {sizesForType.map((variant) => (
                                <Pressable
                                  key={variant.id}
                                  onPress={() => setVariantSelections((prev) => new Map(prev).set(optionId, variant.id))}
                                  className="rounded-lg border px-3 py-2"
                                  style={{ borderColor: colors.royalBlue, backgroundColor: chosenVariantId === variant.id ? colors.royalBlue : '#FFFFFF' }}
                                >
                                  <Text style={{ color: chosenVariantId === variant.id ? '#FFFFFF' : colors.royalBlue }} className="text-sm font-medium">
                                    {variant.name}
                                    {variant.price_delta > 0 ? ` · ₪${variant.price_delta}` : ''}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </>
                        )}
                        {chosenType && sizesForType.length === 1 && (
                          <Text className="mt-2 text-xs" style={{ color: colors.textMuted, textAlign: physicalReadingStart(isRTL) }}>
                            {t('dishServingResolvedPrefix').replace('{option}', option?.name ?? '')}
                            <Text className="font-bold" style={{ color: colors.ink }}>
                              {t(chosenType === 'bottle' ? 'dishServingResolvedBoldBottle' : 'dishServingResolvedBoldDraft')}
                            </Text>
                            {t('dishServingResolvedSuffix').replace('{size}', sizesForType[0]!.name)}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                  {/* Addon hint moved to the card's bottom (2026-09-24, per
                      the user's explicit request) — was beside the group
                      title before, anchored to the physical right (same
                      convention already established elsewhere in this file,
                      e.g. PriceRow's own physical-left anchoring).
                      Real bug (2026-10-28): see visualColumnAlign's own
                      comment in i18n.tsx — this went through the same stuck
                      I18nManager.isRTL flag as flexDirection does, so the
                      literal alignSelf: 'flex-start' was just as unreliable. */}
                  {isAddonGroup && (
                    <View
                      className="mt-2 items-center"
                      style={{ flexDirection: rowDirection, gap: 4, alignSelf: visualColumnAlign(physicalReadingStart(isRTL)) }}
                    >
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
            <View className="mt-6 items-center justify-center" style={{ flexDirection: rowDirection, gap: 16 }}>
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
              className="items-center justify-between rounded-xl px-4 py-4"
              style={{ flexDirection: rowDirection, backgroundColor: canAdd ? colors.royalBlue : '#9CA3AF' }}
            >
              <Text className="text-base font-semibold text-white">
                {soldOut ? t('dishSoldOutButton') : editingItem ? t('updateOrderItemButton') : t('addToOrderButton')}
              </Text>
              {!soldOut && <Text className="text-base font-semibold text-white">₪{formatPrice(unitPrice * quantity)}</Text>}
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

      <DishPhotoGallery visible={galleryVisible} photos={dish.photo_urls} initialIndex={0} onClose={() => setGalleryVisible(false)} />
    </Modal>
  );
}

// The cart-summary bar — moved (2026-10-11, user request) out of its old
// spot absolutely floating over MenuBrowser's own content and into
// OrderingScreen's fixed bottom strip, stacked below CallWaiterInlineTrigger
// there. Reads/writes the cart store directly (isCartOpen lifted into
// cartStore.ts for exactly this reason) rather than taking props, so
// OrderingScreen doesn't need to prop-drill cart state down into — or a
// callback back up out of — MenuBrowser just to render this. Counter badge
// placed after the title in JSX (2026-10-11, user request: it reads to the
// title's physical left) — same reasoning as CallWaiterInlineTrigger's own
// label/icon order under native RTL mirroring; styled to match the
// round-white-badge-on-blue convention from add-participants.tsx's own
// selection counter.
export function CartBarInlineTrigger() {
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const items = useCartStore((s) => s.items);
  const setCartOpen = useCartStore((s) => s.setCartOpen);

  if (items.length === 0) return null;

  return (
    // minHeight, not just py (2026-10-11, user request follow-up) — equal
    // padding alone didn't actually match this button's thickness to
    // requestBillButton/placeOrderButton, since this row's own text-sm
    // content sits shorter than their text-lg/text-base labels; a shared
    // explicit height is what makes all three line up regardless of font
    // size.
    <Pressable
      onPress={() => setCartOpen(true)}
      className="items-center justify-between rounded-xl px-4"
      style={{ flexDirection: rowDirection, backgroundColor: colors.royalBlue, minHeight: 48 }}
    >
      <View className="items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
        <Text className="text-base font-semibold text-white">{t('cartBarLabel')}</Text>
        <View className="items-center justify-center rounded-full bg-white" style={{ height: 20, width: 20 }}>
          <Text className="text-xs font-bold" style={{ color: colors.royalBlue }}>
            {items.length}
          </Text>
        </View>
      </View>
      {/* Split into two Text runs with a gap, not a literal "₪ {price}"
          space (2026-10-11, user request) — a real-device bug already found
          and fixed the same way elsewhere in this file (see the discounted-
          price block above, ~line 1226): a space character between ₪ and
          the number lets the bidi algorithm reorder them wrong. Number
          first in source, ₪ second — same reasoning as there, matches how
          this app's plain "₪{amount}" already renders physically (symbol on
          the visual left, number on the right). */}
      <View className="items-center" style={{ flexDirection: rowDirection, gap: 4 }}>
        <Text className="text-lg font-semibold text-white">{formatPrice(cartTotal(items))}</Text>
        <Text className="text-lg font-semibold text-white">₪</Text>
      </View>
    </Pressable>
  );
}

// The diner's own name + email for CartModal's orderer-details section
// (2026-10-11, user request, mockup 7.1.5-MyOrder Part2.JPG) — same
// auth.getSession() + user_profiles lookup profile.tsx already does, but
// without that screen's own fallback-seeding (upsert-a-default-name-if-
// missing): by the time a diner reaches the cart they've already been
// through onboarding, so a missing row here is the defensive edge case, not
// the expected path — this just shows '—' for it rather than writing data.
function useMyDinerIdentity() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (cancelled || !user) return;
      setEmail(user.email ?? null);
      const { data: profile } = await supabase.from('user_profiles').select('display_name').eq('user_id', user.id).maybeSingle();
      if (!cancelled) setDisplayName(profile?.display_name ?? null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { displayName, email };
}

// Free-text "הוסיפו בקשה מיוחדת" entry (2026-10-11, user request) — same
// blank-field-with-Save/Cancel shape as CancelReasonModal's own "אחר" text
// input, just without that modal's fixed-reason list since every special
// request here is free text from the start. Resets its own draft to
// whatever was last saved (not necessarily blank) each time it opens, so
// re-tapping an already-set request shows what's there to edit, not a
// blank box.
function SpecialRequestModal({
  visible,
  initialText,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initialText: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const { t, isRTL } = useI18n();
  const [text, setText] = useState(initialText);

  useEffect(() => {
    // Resets the draft to whatever was last saved each time the modal
    // reopens — not computed during render since `text` must still track
    // typing while open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) setText(initialText);
  }, [visible, initialText]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          <Text className="mb-3 text-lg font-bold text-[#1B2430]">{t('specialRequestModalTitle')}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('specialRequestPlaceholder')}
            placeholderTextColor="#9CA3AF"
            className="rounded-xl border px-4 py-3 text-sm text-[#1B2430]"
            style={{ borderColor: colors.border, minHeight: 90, textAlignVertical: 'top' }}
            multiline
            autoFocus
          />
          <View className="mt-4" style={{ flexDirection: visualRowDirection(!isRTL), gap: 12 }}>
            <Pressable onPress={() => onSave(text.trim())} className="flex-1 items-center rounded-lg py-3" style={{ backgroundColor: colors.royalBlue }}>
              <Text className="font-semibold text-white">{t('save')}</Text>
            </Pressable>
            <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border py-3" style={{ borderColor: colors.border }}>
              <Text className="font-semibold text-[#1B2430]">{t('cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CartModal({
  visible,
  onClose,
  onPlaced,
  dishById,
  onEditItem,
}: {
  visible: boolean;
  onClose: () => void;
  onPlaced: () => void;
  dishById: Map<string, Dish>;
  // Closes this sheet and reopens DishDetailModal pre-filled with the
  // item's existing selections (2026-10-11, user request) — handled by the
  // parent (MenuBrowser), not here, since that's where selectedDish/the
  // detail modal itself already lives.
  onEditItem: (item: CartLineItem) => void;
}) {
  const { t, isRTL } = useI18n();
  const rowDirection = visualRowDirection(isRTL);
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);
  const specialRequest = useCartStore((s) => s.specialRequest);
  const setSpecialRequest = useCartStore((s) => s.setSpecialRequest);
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const participantId = useTableSessionStore((s) => s.participantId);
  const tableNumber = useTableSessionStore((s) => s.tableNumber);
  const subAccountNumber = useTableSessionStore((s) => s.subAccountNumber);
  const reviewVerificationCode = useTableSessionStore((s) => s.reviewVerificationCode);
  const { displayName, email } = useMyDinerIdentity();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [specialRequestModalOpen, setSpecialRequestModalOpen] = useState(false);
  // Escape-route confirmation before removing a line (2026-10-11, user
  // request) — holds the item id pending confirmation, not just a boolean,
  // since the list can have several rows and each needs its own trash tap
  // to resolve to the right one.
  const [removeConfirmItemId, setRemoveConfirmItemId] = useState<string | null>(null);

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
          modifier_selections: item.modifierSelections.map((m) => ({
            modifier_option_id: m.modifierOptionId,
            serving_variant_id: m.servingVariantId,
          })),
        })),
        special_request: specialRequest,
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
          <View className="items-center justify-between border-b p-4" style={{ flexDirection: rowDirection, borderColor: colors.border }}>
            <Text className="text-lg font-bold text-[#1B2430]">{t('cartTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color="#6E6A61" />
            </Pressable>
          </View>

          {/* Orderer details (2026-10-11, user request, mockup
              7.1.5-MyOrder Part2.JPG) — name, email, table number, personal
              sub-account number, and the locked review-verification code
              (reviewVerificationCode; same field AccountScreen's strip
              already shows as "קוד חשבון", relabeled here to match the
              mockup's own "קוד סוד" wording for this screen specifically).
              Phone number deliberately omitted (2026-10-11, user decision):
              nothing in this data model stores a diner's phone today — sign-
              in is email+password only, SMS MFA is still deferred per
              sms_mfa_deferred — so there is no real value to mask here yet. */}
          <View className="border-b px-4 py-3" style={{ borderColor: colors.border }}>
            <View className="items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
              <Ionicons name="person-outline" size={15} color="#6E6A61" />
              {/* Real bug (2026-10-28): flex-1 Text with no explicit
                  textAlign — same issue as CategoryCard's own title, see
                  that fix's comment in i18n.tsx (physicalReadingStart). */}
              <Text className="flex-1 text-xs text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }} numberOfLines={1}>
                {t('orderedByLabel')} {displayName ?? '—'}
              </Text>
            </View>
            <View className="mt-1.5 items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
              <Ionicons name="mail-outline" size={15} color="#6E6A61" />
              <Text className="flex-1 text-xs text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }} numberOfLines={1}>
                {email ?? '—'}
              </Text>
            </View>
            <View className="mt-1.5 items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
              <Ionicons name="grid-outline" size={15} color="#6E6A61" />
              <Text className="text-xs text-[#1B2430]">
                {t('accountStripTableLabel')}: {tableNumber ?? '—'}
              </Text>
            </View>
            <View className="mt-1.5 items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
              <Ionicons name="receipt-outline" size={15} color="#6E6A61" />
              <Text className="text-xs text-[#1B2430]">
                {t('personalAccountNumberLabel')}: {subAccountNumber ?? '—'}
              </Text>
            </View>
            <View className="mt-1.5 items-center" style={{ flexDirection: rowDirection, gap: 8 }}>
              <Ionicons name="lock-closed-outline" size={15} color="#6E6A61" />
              <Text className="text-xs text-[#1B2430]">
                {t('cartOrderSecretCodeLabel')}: {reviewVerificationCode ?? '—'}
              </Text>
            </View>
          </View>

          {items.length === 0 ? (
            <View className="items-center px-6 py-10">
              <Text className="text-center text-sm text-[#9CA3AF]">{t('cartEmpty')}</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ padding: 16 }}>
              {items.map((item) => {
                const photoUrl = dishById.get(item.dishId)?.photo_urls[0] ?? null;
                return (
                  <View key={item.id} className="mb-3 items-center" style={{ flexDirection: rowDirection, gap: 10 }}>
                    {/* Dish photo on the physical right (2026-10-11, user
                        request) — driven through rowDirection (see i18n.tsx's
                        visualRowDirection), not plain first-in-JSX native
                        mirroring, which this app's native RTL flag can't be
                        relied on for (2026-10-27 real bug, see AppHeader.tsx).
                        Falls back to a plain placeholder tile for a dish
                        with no photo, rather than leaving a gap. */}
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={{ height: 48, width: 48, borderRadius: 8 }} />
                    ) : (
                      <View className="items-center justify-center rounded-lg" style={{ height: 48, width: 48, backgroundColor: '#F1F0ED' }}>
                        <MaterialCommunityIcons name="room-service-outline" size={20} color="#9CA3AF" />
                      </View>
                    )}
                    {/* Real bug (2026-10-28): plain block Texts stretch to
                        fill this column's full width by default, same as
                        CategoryCard's own title — explicit textAlign needed
                        since 'auto' depends on the stuck native RTL flag. */}
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-[#1B2430]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                        {item.quantity}× {item.dishName}
                      </Text>
                      {(item.sizeOptionName || item.modifierSummary) && (
                        <Text className="mt-0.5 text-xs text-[#9CA3AF]" style={{ textAlign: physicalReadingStart(isRTL) }}>
                          {[item.sizeOptionName, item.modifierSummary].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                    <Text className="text-base font-semibold text-[#1B2430]">₪{formatPrice(item.unitPrice * item.quantity)}</Text>
                    {/* Edit icon (2026-10-11, user request) — reopens
                        DishDetailModal pre-filled with this item's existing
                        size/modifiers/quantity; closes this sheet first so
                        the two modals don't stack. Only rendered when the
                        dish is still on the live menu — an item from a dish
                        since removed/hidden has nothing to reopen. */}
                    {dishById.has(item.dishId) && (
                      <Pressable
                        onPress={() => {
                          onClose();
                          onEditItem(item);
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="create-outline" size={18} color="#6E6A61" />
                      </Pressable>
                    )}
                    {/* Trash icon, not a "הסרה" text label (2026-10-11, user
                        request) — accessibilityLabel keeps the existing
                        cartItemRemove translation key meaningful for screen
                        readers instead of dropping it as dead code. Opens
                        the M-05 confirmation below instead of removing
                        immediately (2026-10-11, follow-up user request). */}
                    <Pressable onPress={() => setRemoveConfirmItemId(item.id)} accessibilityLabel={t('cartItemRemove')} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Special-request trigger (2026-10-11, user request) — sits right
              below the itemized dish list, one free-text note for the whole
              order (not per dish). Shows the saved text once set, so
              re-tapping reopens the modal to edit rather than starting
              blank again. Sent once alongside the whole order
              (handlePlaceOrder below) and surfaced to kitchen staff as a new
              column on the orders table in Web Admin's "הזמנות ומטבח"
              module (useOrders.ts / KitchenScreen.tsx). */}
          {items.length > 0 && (
            <Pressable
              onPress={() => setSpecialRequestModalOpen(true)}
              className="items-center border-t px-4 py-3"
              style={{ flexDirection: rowDirection, gap: 8, borderColor: colors.border }}
            >
              <Ionicons name="create-outline" size={16} color={colors.royalBlue} />
              <Text
                className="flex-1 text-sm font-medium"
                style={{ color: colors.royalBlue, textAlign: physicalReadingStart(isRTL) }}
                numberOfLines={2}
              >
                {specialRequest || t('addSpecialRequestLabel')}
              </Text>
            </Pressable>
          )}

          <View className="border-t px-4 py-3" style={{ borderColor: colors.border }}>
            <View className="mb-3 items-center justify-between" style={{ flexDirection: rowDirection }}>
              <Text className="text-sm font-medium text-[#6E6A61]">{t('cartTotalLabel')}</Text>
              <Text className="text-xl font-bold text-[#1B2430]">₪{formatPrice(cartTotal(items))}</Text>
            </View>
            {/* minHeight 48, matching CartBarInlineTrigger/requestBillButton
                exactly (2026-10-11, user request) — see CartBarInlineTrigger's
                own comment for why padding alone can't do this across
                different font sizes. */}
            <Pressable
              onPress={() => void handlePlaceOrder()}
              disabled={items.length === 0 || busy}
              className="items-center justify-center rounded-xl"
              style={{ backgroundColor: items.length === 0 || busy ? '#9CA3AF' : colors.royalBlue, minHeight: 48 }}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-semibold text-white">{t('placeOrderButton')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      <ErrorModal visible={errorMessage !== null} title={t('placeOrderFailedTitle')} message={errorMessage ?? ''} dismissLabel={t('gotIt')} onDismiss={() => setErrorMessage(null)} />

      {/* M-05 escape-route confirmation before removing a cart line
          (2026-10-11, user request) — same ConfirmModal reused for
          sign-out/call-waiter, with "הסרה"/"חזרה" as its two action
          labels specifically. */}
      <ConfirmModal
        visible={removeConfirmItemId !== null}
        title={t('cartRemoveItemConfirmTitle')}
        message={t('cartRemoveItemConfirmMessage')}
        cancelLabel={t('back')}
        confirmLabel={t('cartItemRemove')}
        danger
        onCancel={() => setRemoveConfirmItemId(null)}
        onConfirm={() => {
          if (removeConfirmItemId) removeItem(removeConfirmItemId);
          setRemoveConfirmItemId(null);
        }}
      />

      <SpecialRequestModal
        visible={specialRequestModalOpen}
        initialText={specialRequest ?? ''}
        onCancel={() => setSpecialRequestModalOpen(false)}
        onSave={(text) => {
          setSpecialRequest(text === '' ? null : text);
          setSpecialRequestModalOpen(false);
        }}
      />
    </Modal>
  );
}

export function MenuBrowser({ onOrderPlaced }: { onOrderPlaced: () => void }) {
  const { t, isRTL } = useI18n();
  const navigation = useNavigation();
  const restaurantId = useTableSessionStore((s) => s.restaurantId);
  const isBarTable = useTableSessionStore((s) => s.tableType === 'bar');
  const { data, loading } = useMenuData(restaurantId);
  const orderStats = useDishOrderStats(restaurantId);
  const { counts: presence, trackDish, untrackDish } = useDishPresence(restaurantId);
  const criticalStock = useDishCriticalStock(restaurantId);
  const missingIngredients = useDishMissingIngredients(restaurantId);
  const unavailableOptions = useUnavailableModifierOptions(restaurantId);
  const vatRatePercent = useRestaurantVatRate(restaurantId);
  const { likedDishIds, likedCategoryIds } = useMyLikes();
  const [section, setSection] = useState<MenuSection>('food');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  // Set alongside selectedDish only when DishDetailModal was opened via the
  // cart's edit icon (2026-10-11, user request), never from the regular
  // dish-list tap — that's what tells the modal to pre-fill from this item
  // and replace it on save instead of adding a new line.
  const [editingCartItem, setEditingCartItem] = useState<CartLineItem | null>(null);
  const cartOpen = useCartStore((s) => s.isCartOpen);
  const setCartOpen = useCartStore((s) => s.setCartOpen);
  // Filter/sort state for the dish-list-within-category screen (2026-10-01,
  // per explicit request) — reset whenever the diner leaves the category
  // (categoryId changes), so re-entering a (possibly different) category
  // never carries over a stale filter from the last one.
  const [dishSort, setDishSort] = useState<DishSortOption>(null);
  const [dishFilters, setDishFilters] = useState<DishFilterState>(DEFAULT_DISH_FILTERS);
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [filterScreenVisible, setFilterScreenVisible] = useState(false);
  useEffect(() => {
    // Resets when categoryId changes — not computed during render since
    // dishSort/dishFilters must still track the diner's own picks while in
    // a category.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDishSort(null);
    setDishFilters(DEFAULT_DISH_FILTERS);
  }, [categoryId]);

  // Same LIFO device-back convention already established for internal stage
  // machines elsewhere (add-participants.tsx, 2026-09-10) — being inside a
  // category's dish list is its own "stage" on top of the category grid, and
  // the device's own back control (hardware button on Android, edge-swipe on
  // iOS) has no idea this screen has that internal state. Left unhandled,
  // either would pop straight past the category view to whatever real route
  // sits behind this screen (2026-10-01, per explicit request).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (categoryId !== null) {
        setCategoryId(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [categoryId]);

  // iOS equivalent (BackHandler is Android-only) — same reasoning as
  // add-participants.tsx's own gestureEnabled toggle: iOS's edge-swipe can't
  // be intercepted and redirected to an internal state the way Android's
  // hardwareBackPress can, so it's disabled entirely while inside a
  // category, forcing the explicit in-screen back link below instead of
  // letting the swipe skip past it.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: categoryId === null });
  }, [navigation, categoryId]);

  if (loading || !data) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.royalBlue} />
      </View>
    );
  }

  // Bar menu scoping (2026-10-15, Implementation Plan §10) — a restaurant's
  // bar can offer a curated subset of the menu (dishes.bar_orderable, set in
  // MenuManager.tsx), not just everything or an all/nothing food/drink
  // split. Only filters when the diner is actually at the bar table — every
  // other table sees the unfiltered menu exactly as before.
  const visibleDishesByCategory = isBarTable
    ? new Map(
        Array.from(data.dishesByCategory.entries()).map(([catId, dishes]) => [catId, dishes.filter((d) => d.bar_orderable)]),
      )
    : data.dishesByCategory;

  // Flat dishId → Dish lookup for CartModal's own item rows (2026-10-11,
  // user request) — cart line items only ever stored
  // dishId/dishName/pricing, never the dish's own photo, so this is built
  // fresh each render from the same dishesByCategory data already loaded
  // here rather than adding fields to CartLineItem just for display. Also
  // what resolves a cart item's edit icon back to a real Dish to reopen in
  // DishDetailModal (see editingCartItem below).
  const dishById = new Map<string, Dish>();
  for (const dishes of visibleDishesByCategory.values()) {
    for (const dish of dishes) {
      dishById.set(dish.id, dish);
    }
  }

  // A category left with zero bar-orderable dishes after filtering isn't
  // shown at all for a bar diner — an empty category tile would be
  // confusing with nothing to explain why.
  const categoriesInSection = data.categories.filter(
    (c) => c.section === section && (!isBarTable || (visibleDishesByCategory.get(c.id)?.length ?? 0) > 0),
  );
  const activeCategory = categoryId ? data.categories.find((c) => c.id === categoryId) : null;
  const dishesInActiveCategory = activeCategory ? (visibleDishesByCategory.get(activeCategory.id) ?? []) : [];
  // Filtered + sorted view of the category's dish list (2026-10-01, per
  // explicit request) — categoryOrdersToday below still reads from the full
  // (unfiltered) dishesInActiveCategory, since the "ביקוש גבוה" ratio is
  // about the category's real order activity as a whole, not just whichever
  // subset happens to currently be visible.
  const visibleDishesInActiveCategory = sortDishesForDisplay(
    dishesInActiveCategory.filter((d) =>
      dishMatchesFilters(d, effectiveDishPrice(d, data.sizesByDish.get(d.id) ?? []), criticalStock.get(d.id), dishFilters),
    ),
    dishSort,
    orderStats,
    data.sizesByDish,
  );
  const hasActiveDishFilters = !dishFilterIsEmpty(dishFilters);

  return (
    <View className="flex-1">
      {/* Mockups 7.1/7.2: two icon+label tabs with a blue underline under
          the active one — a distinct, lighter-weight style from
          OrderingTabBar's own amber underline (that one is the app's
          primary nav; this is a sub-toggle inside the Menu tab itself).
          Two equal flex:1 columns (not a centered cluster with a gap) so
          each tab sits centered within its own half of the white strip,
          matching the mockup's left-half/right-half split. */}
      {/* Food/drink section toggle only while browsing categories — once a
          diner has drilled into one category's own dish list, that section
          choice no longer applies, and the filter/sort bar takes its place
          instead (2026-10-01, per explicit request + mockup
          7.1.1.2-Meats menus filter.JPG). */}
      {activeCategory ? (
        <FilterSortBar
          onOpenFilter={() => setFilterScreenVisible(true)}
          onOpenSort={() => setSortSheetVisible(true)}
          hasActiveFilters={hasActiveDishFilters}
          t={t}
        />
      ) : (
        // Real bug (2026-10-27): plain flex-row relied on a native RTL flag
        // that doesn't reliably flip on a real device — driven explicitly
        // instead (see i18n.tsx's visualRowDirection).
        <View style={{ flexDirection: visualRowDirection(isRTL), borderBottomWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }}>
          {(['food', 'drink'] as MenuSection[]).map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                setSection(s);
                setCategoryId(null);
              }}
              className="flex-1 items-center justify-center py-3"
              style={{ flexDirection: visualRowDirection(isRTL), gap: 6, borderBottomWidth: section === s ? 2 : 0, borderColor: colors.royalBlue }}
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
      )}

      {activeCategory ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Only the category name text itself is tappable (2026-10-01, per
              explicit request) — the chevron icon is now purely decorative,
              not part of the touch target. */}
          <View className="items-center gap-1 p-3" style={{ flexDirection: visualRowDirection(isRTL) }}>
            <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={16} color={colors.royalBlue} />
            <Pressable onPress={() => setCategoryId(null)} hitSlop={8}>
              <Text className="text-sm font-medium" style={{ color: colors.royalBlue }}>
                {activeCategory.name}
              </Text>
            </Pressable>
          </View>
          {dishesInActiveCategory.length === 0 ? (
            <Text className="px-6 py-8 text-center text-sm text-[#9CA3AF]">{t('menuCategoryEmpty')}</Text>
          ) : visibleDishesInActiveCategory.length === 0 ? (
            <Text className="px-6 py-8 text-center text-sm text-[#9CA3AF]">{t('dishFilterNoMatches')}</Text>
          ) : (
            (() => {
              // Denominator for the "ביקוש גבוה" ratio (item 2) — every
              // dish's own share of today's orders within this same
              // category, computed once per render rather than per row.
              // Reads from the FULL category list, not the filtered/sorted
              // view below, so the ratio reflects real order activity
              // regardless of which subset is currently visible.
              const categoryOrdersToday = dishesInActiveCategory.reduce((sum, d) => sum + (orderStats.get(d.id)?.count ?? 0), 0);
              return visibleDishesInActiveCategory.map((dish) => (
                <DishRow
                  key={dish.id}
                  dish={dish}
                  sizes={data.sizesByDish.get(dish.id) ?? []}
                  onPress={() => setSelectedDish(dish)}
                  t={t}
                  orderStats={orderStats.get(dish.id)}
                  presenceCount={presence.get(dish.id) ?? 0}
                  categoryOrdersToday={categoryOrdersToday}
                  criticalStockStatus={criticalStock.get(dish.id)}
                  vatRatePercent={vatRatePercent}
                  initiallyLiked={likedDishIds.has(dish.id)}
                />
              ));
            })()
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
          {categoriesInSection.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              dishes={data.dishesByCategory.get(category.id) ?? []}
              onPress={() => setCategoryId(category.id)}
              t={t}
              isRTL={isRTL}
              initiallyLiked={likedCategoryIds.has(category.id)}
            />
          ))}
        </ScrollView>
      )}

      {selectedDish && (
        <DishDetailModal
          dish={selectedDish}
          sizes={data.sizesByDish.get(selectedDish.id) ?? []}
          groups={data.groupsByDish.get(selectedDish.id) ?? []}
          optionsByGroup={data.optionsByGroup}
          variantsByOption={data.variantsByOption}
          soldOut={criticalStock.get(selectedDish.id) === 'out'}
          missingIngredientNames={missingIngredients.get(selectedDish.id) ?? []}
          unavailableOptionIds={unavailableOptions}
          editingItem={editingCartItem}
          onClose={() => {
            setSelectedDish(null);
            setEditingCartItem(null);
          }}
          onAdded={() => {
            setSelectedDish(null);
            setEditingCartItem(null);
          }}
          trackDish={trackDish}
          untrackDish={untrackDish}
        />
      )}

      <CartModal
        visible={cartOpen}
        onClose={() => setCartOpen(false)}
        onPlaced={() => {
          setCartOpen(false);
          onOrderPlaced();
        }}
        dishById={dishById}
        onEditItem={(item) => {
          const dish = dishById.get(item.dishId);
          if (!dish) return;
          setEditingCartItem(item);
          setSelectedDish(dish);
        }}
      />

      <SortSheet visible={sortSheetVisible} onClose={() => setSortSheetVisible(false)} value={dishSort} onChange={setDishSort} t={t} />
      <FilterScreen
        visible={filterScreenVisible}
        onClose={() => setFilterScreenVisible(false)}
        filters={dishFilters}
        onChange={setDishFilters}
        dishes={dishesInActiveCategory}
        sizesByDish={data.sizesByDish}
        criticalStock={criticalStock}
        t={t}
      />
    </View>
  );
}
