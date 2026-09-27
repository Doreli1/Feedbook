import { Fragment, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../../lib/i18n';
import type { TranslationKey } from '../../lib/translations';
import { supabase } from '../../lib/supabase';
import { extractFunctionErrorCode } from '../../lib/functionError';
import { useTableSessionStore } from '../../lib/tableSessionStore';
import { ErrorModal } from '../ErrorModal';
import { CancelReasonModal } from './CancelReasonModal';
import { StarRow } from '../menu/MenuBrowser';
import { colors } from '../../theme';

type ItemStatus = 'in_progress' | 'ready' | 'served' | 'cancelled';

interface TrackedItem {
  id: string;
  orderId: string;
  status: ItemStatus;
  statusUpdatedAt: string;
  quantity: number;
  unitPrice: number;
  placedAt: string;
  dishName: string;
  dishPhoto: string | null;
  sizeName: string | null;
  modifierSummary: string;
  // Optional per-dish expected cooking time, set by the restaurant in the
  // menu editor (added 2026-09-19 alongside the kitchen-side traffic
  // light) — null means the dish never had one configured, in which case
  // nothing is shown here.
  prepTimeMinutes: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  feedstarsEligible: boolean;
  // Set only for an order placed at the shared bar — the short-lived
  // pickup ticket bar staff work by (never this diner's own persistent
  // account number, which stays private to them). The only content
  // difference between a table order and a bar order in this tracker.
  barTicketNumber: number | null;
}

const EDIT_WINDOW_MINUTES = 5;

// The already-decided visual design (project memory
// project_stage5_alignment_decisions, "Style B" comparison artifact): a
// vertical timeline, 4 locked stages matching Content Guidelines' status
// terminology, monochrome outline Ionicons, a checkmark overriding a
// completed stage's icon. order_items only ever has 3 real statuses
// (in_progress/ready/served) — "received" and "preparing" both show
// complete/current the instant an item exists (status='in_progress' from
// creation), since there's no separate kitchen-acknowledge step to
// distinguish them.
const STAGES: { status: ItemStatus | 'in_progress'; icon: keyof typeof Ionicons.glyphMap; labelKey: TranslationKey; minIndex: number }[] = [
  { status: 'in_progress', icon: 'receipt-outline', labelKey: 'orderStatusReceived', minIndex: 0 },
  { status: 'in_progress', icon: 'flame-outline', labelKey: 'orderStatusPreparing', minIndex: 1 },
  { status: 'ready', icon: 'notifications-outline', labelKey: 'orderStatusReady', minIndex: 2 },
  { status: 'served', icon: 'restaurant-outline', labelKey: 'orderStatusServed', minIndex: 3 },
];

function stageIndexForStatus(status: ItemStatus): number {
  if (status === 'ready') return 2;
  if (status === 'served') return 3;
  return 1;
}

// Horizontal layout (requested 2026-09-19, replacing the original vertical
// timeline) — placed below the action buttons rather than between the photo
// and the buttons. Each stage is an equal-width column (icon + label); the
// connecting line between two stages is colored completed the moment the
// later stage has been reached. Relies on the app-wide I18nManager.forceRTL
// flip (see i18n.tsx) to mirror this plain flex-row so the first stage
// ("received") renders at the physical right, matching reading order.
function HorizontalStatusTimeline({ item, t }: { item: TrackedItem; t: (key: TranslationKey) => string }) {
  const currentIndex = stageIndexForStatus(item.status);
  return (
    <View className="mt-3 flex-row items-start">
      {STAGES.map((stage, index) => {
        const completed = index <= currentIndex;
        return (
          <Fragment key={stage.labelKey}>
            <View className="items-center" style={{ flex: 1 }}>
              <View
                className="items-center justify-center rounded-full"
                style={{ width: 26, height: 26, backgroundColor: completed ? colors.royalBlue : '#EFEBE2' }}
              >
                <Ionicons name={completed ? 'checkmark' : stage.icon} size={14} color={completed ? '#FFFFFF' : '#9CA3AF'} />
              </View>
              <Text className="mt-1 text-center text-[10px] font-medium" numberOfLines={1} style={{ color: completed ? '#1B2430' : '#9CA3AF' }}>
                {t(stage.labelKey)}
              </Text>
            </View>
            {index < STAGES.length - 1 && (
              <View style={{ flex: 0.6, height: 2, marginTop: 12, backgroundColor: index + 1 <= currentIndex ? colors.royalBlue : '#EFEBE2' }} />
            )}
          </Fragment>
        );
      })}
    </View>
  );
}

// Cancellation-policy explainer line (requested 2026-09-19, placed below
// the horizontal timeline) — a green checkmark leads each sentence instead
// of a plain bullet character, per the user's explicit request.
// text-xs's line height (Tailwind/NativeWind default for fontSize 12).
const BULLET_LINE_HEIGHT = 16;
// text-sm's line height (Tailwind/NativeWind default for fontSize 14) — used
// by the edit-window-expired note's info badge below, same technique.
const NOTE_LINE_HEIGHT = 20;

function PolicyBullet({ text }: { text: string }) {
  return (
    // items-start on the row (so a wrapped second line doesn't pull the
    // icon down with it), but the icon itself lives in its own
    // BULLET_LINE_HEIGHT-tall box with internal centering — that's what
    // actually pins it to the *first line*'s vertical center specifically,
    // rather than the row's top edge in the abstract. A plain marginTop
    // nudge (tried twice before, 2026-09-19) can't do this: its offset is
    // fixed in absolute pixels, so it looks right on a two-line bullet and
    // wrong on a one-line one (or vice versa) — this scales with the text
    // itself instead.
    <View className="flex-row items-start" style={{ gap: 6 }}>
      {/* MaterialCommunityIcons' "check-bold" — a purpose-built bold variant
          (Ionicons' plain "checkmark" and MaterialIcons' "check" both have
          no bolder alternative; this glyph is the actual answer to "a bit
          thicker still", not another guess at size/color). Darker green
          than colors.success (#22C55E) per the user's request. */}
      <View style={{ height: BULLET_LINE_HEIGHT, justifyContent: 'center' }}>
        <MaterialCommunityIcons name="check-bold" size={15} color="#16A34A" />
      </View>
      <Text className="flex-1 text-xs text-[#6E6A61]" style={{ lineHeight: BULLET_LINE_HEIGHT }}>
        {text}
      </Text>
    </View>
  );
}

function OrderItemCard({
  item,
  highlighted,
  onCancelled,
  onChanged,
  t,
}: {
  item: TrackedItem;
  highlighted: boolean;
  onCancelled: (id: string) => void;
  onChanged: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showReasonModal, setShowReasonModal] = useState(false);

  const elapsedMinutes = (Date.now() - new Date(item.placedAt).getTime()) / 60000;
  const canModify = item.status === 'in_progress' && elapsedMinutes <= EDIT_WINDOW_MINUTES;
  // Distinguishes "can no longer act because the 5-minute window passed"
  // from "can no longer act because it's already ready/served/cancelled" —
  // only the former needs an explanation, since the latter is already
  // self-evident from the status pill/timeline itself.
  const editWindowExpired = item.status === 'in_progress' && !canModify;

  async function handleCancel(reason: string) {
    setBusy(true);
    // update-order-item requires PATCH (API Specification §7.2) — invoke()
    // defaults to POST when `method` isn't passed explicitly, which the
    // function's own method check then rejects with 405 before it ever
    // touches the database. Found 2026-09-19 during the first-ever real-
    // device test of order cancellation: every prior symptom (stale auth,
    // a hung edge-runtime isolate) was a red herring chased before this
    // plain method mismatch was found via the gateway's own access log.
    const { error } = await supabase.functions.invoke('update-order-item', {
      method: 'PATCH',
      body: { order_item_id: item.id, action: 'cancel', cancellation_reason: reason },
    });
    setBusy(false);
    if (error) {
      const code = await extractFunctionErrorCode(error);
      if (code === 'EDIT_WINDOW_EXPIRED') setErrorMessage(t('editWindowExpiredMessage'));
      else if (code === 'ITEM_ALREADY_READY') setErrorMessage(t('itemAlreadyReadyMessage'));
      else setErrorMessage(t('placeOrderFailedMessage'));
      return;
    }
    // Keeps this card visible with a "cancelled" label instead of vanishing
    // the instant the refetch (onChanged) lands — requested 2026-09-19, so
    // the diner gets a clear, in-place confirmation of their own action
    // rather than the card just disappearing.
    onCancelled(item.id);
    onChanged();
  }

  return (
    <View className="mb-3 rounded-xl bg-white p-3" style={{ borderWidth: highlighted ? 2 : 1, borderColor: highlighted ? colors.royalBlue : colors.border }}>
      {item.barTicketNumber !== null && (
        // The only content difference between a table order and a bar
        // order in this tracker: the short-lived pickup ticket bar staff
        // work by (never this diner's own persistent account number,
        // which stays private to them) — this is what to watch for and
        // match against the printed label at pickup.
        <View className="mb-2 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: colors.smoking }}>
          <Text className="text-xs font-bold text-white">
            {t('orderBarTicketLabel')} #{String(item.barTicketNumber).padStart(4, '0')}
          </Text>
        </View>
      )}
      <Text className="text-base font-semibold text-[#1B2430]">
        {item.quantity}× {item.dishName}
      </Text>
      {(item.ratingCount > 0 || item.feedstarsEligible) && (
        <View className="mt-1 flex-row items-center" style={{ gap: 6 }}>
          {item.ratingCount > 0 && <StarRow value={item.ratingAvg ?? 0} size={14} />}
          {item.feedstarsEligible && (
            // Same badge as the menu browser's dish list (MenuBrowser.tsx) —
            // gold background, Baloo 2 wordmark, sparkles icon — reused
            // verbatim rather than a one-off here. Per the mockup, it sits
            // to the physical left of the stars (JSX order = visual
            // right-to-left under this app's forced RTL, so it's written
            // second).
            <View className="flex-row items-center rounded px-2 py-0.5" style={{ backgroundColor: '#F5A623', gap: 2 }}>
              <Ionicons name="sparkles-outline" size={11} color="#FFFFFF" />
              <Text style={{ fontFamily: 'Baloo2_700Bold', fontSize: 11, color: '#FFFFFF' }}>{t('dishFeedstarsBadge')}</Text>
            </View>
          )}
        </View>
      )}

      {item.dishPhoto ? (
        <Image source={{ uri: item.dishPhoto }} style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 10 }} />
      ) : (
        <View style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 10, backgroundColor: '#EFEBE2' }} />
      )}
      {(item.sizeName || item.modifierSummary) && (
        <Text className="mt-1.5 text-xs text-[#9CA3AF]">{[item.sizeName, item.modifierSummary].filter(Boolean).join(' · ')}</Text>
      )}

      {item.status === 'cancelled' ? (
        <View className="mt-3 items-center rounded-lg py-2.5" style={{ backgroundColor: '#EFEBE2' }}>
          <Text className="text-sm font-semibold text-[#6E6A61]">{t('orderCancelledLabel')}</Text>
        </View>
      ) : (
        canModify && (
          <View className="mt-3 flex-row items-stretch" style={{ gap: 10 }}>
            <Pressable onPress={() => setShowReasonModal(true)} disabled={busy} className="flex-1 items-center justify-center rounded-lg border py-2.5" style={{ borderColor: colors.danger }}>
              {busy ? <ActivityIndicator color={colors.danger} /> : (
                <Text className="text-sm font-semibold" style={{ color: colors.danger }}>
                  {t('cancelItemButton')}
                </Text>
              )}
            </Pressable>
            <View style={{ width: 1, backgroundColor: colors.border }} />
            {/* Documented-but-not-built yet (2026-09-19): item editing (size/
                modifiers/quantity) has no server-side support at all today,
                only cancellation does. Shown locked — same treatment as the
                still-unbuilt rows in BurgerSideMenu.tsx (muted text +
                lock-closed-outline icon, not interactive) — purely so this
                intended future action stays visible in the design instead of
                being forgotten. */}
            <View className="flex-1 flex-row items-center justify-center rounded-lg border py-2.5" style={{ borderColor: colors.border, gap: 6 }}>
              <Text className="text-sm font-semibold text-[#9CA3AF]">{t('modifyItemButton')}</Text>
              <Ionicons name="lock-closed-outline" size={14} color="#C7C2B4" />
            </View>
          </View>
        )
      )}

      <HorizontalStatusTimeline item={item} t={t} />

      {canModify && (
        <View className="mt-3" style={{ gap: 5 }}>
          <PolicyBullet text={t('orderEditPolicyBullet').replace('{minutes}', String(EDIT_WINDOW_MINUTES))} />
          <PolicyBullet text={t('orderFreeCancelBullet')} />
        </View>
      )}

      {editWindowExpired && (
        // Same slot the policy bullets occupy when the window is still
        // open — the two states are mutually exclusive, so this fills the
        // same visual place once it closes, explaining *why* the buttons
        // and bullets just disappeared instead of leaving that unexplained.
        // Badge matches the account-management strip's own info button
        // (OrderingScreen.tsx: "information-outline" in a filled #38BDF8
        // circle) — flat, no drop shadow, per the user's final correction
        // (2026-09-19; an intermediate version added one to match a
        // reference image, then the user asked for a clean look instead).
        // Sized down and aligned the same way PolicyBullet's checkmark is:
        // the badge sits in its own NOTE_LINE_HEIGHT-tall box
        // with internal centering, so it tracks the text's *first line*
        // specifically (proportionate to text-sm here, not a fixed 24px
        // circle that reads oversized next to it) rather than the mid-point
        // of however many lines the note wraps to.
        <View className="mt-3 flex-row items-start" style={{ gap: 8 }}>
          <View style={{ height: NOTE_LINE_HEIGHT, justifyContent: 'center' }}>
            <View className="items-center justify-center rounded-full" style={{ width: 18, height: 18, backgroundColor: '#38BDF8' }}>
              <Ionicons name="information-outline" size={11} color="#FFFFFF" />
            </View>
          </View>
          <Text className="flex-1 text-sm text-[#6E6A61]" style={{ lineHeight: NOTE_LINE_HEIGHT }}>
            {t('orderEditWindowPassedNote').replace('{minutes}', String(EDIT_WINDOW_MINUTES))}
          </Text>
        </View>
      )}

      {/* Price and estimated prep time share one row again, split by a
          vertical divider with each side centered within its own half —
          mirrors the action-buttons row's own flex-1/divider/flex-1
          pattern above, matching mockup "9 - Orders.JPG"'s layout
          (price on the physical left, prep time on the physical right;
          JSX order is reversed accordingly since this flex-row is
          RTL-mirrored). Restored 2026-09-19 after the stacked/centered
          version the previous turn shipped didn't match the mockup. */}
      <View className="mt-3 flex-row items-center" style={{ gap: 10 }}>
        {item.prepTimeMinutes !== null && (
          <>
            <View className="flex-1 flex-row items-center justify-center" style={{ gap: 4 }}>
              <Ionicons name="time-outline" size={16} color="#6E6A61" />
              <Text className="text-xs text-[#6E6A61]">
                {t('orderEstimatedPrepTimeLabel')} <Text className="font-bold text-[#1B2430]">{t('orderEstimatedPrepTimeValue').replace('{minutes}', String(item.prepTimeMinutes))}</Text>
              </Text>
            </View>
            <View style={{ width: 1, height: 24, backgroundColor: colors.border }} />
          </>
        )}
        <View className="flex-1 items-center">
          <Text className="text-xl font-bold" style={{ color: colors.royalBlue }}>
            ₪{(item.unitPrice * item.quantity).toFixed(2)}
          </Text>
        </View>
      </View>

      <CancelReasonModal
        visible={showReasonModal}
        onBack={() => setShowReasonModal(false)}
        onConfirm={(reason) => {
          setShowReasonModal(false);
          void handleCancel(reason);
        }}
      />

      <ErrorModal visible={errorMessage !== null} title={t('placeOrderFailedTitle')} message={errorMessage ?? ''} dismissLabel={t('gotIt')} onDismiss={() => setErrorMessage(null)} />
    </View>
  );
}

interface RawOrderItemRow {
  id: string;
  order_id: string;
  status: ItemStatus;
  status_updated_at: string;
  quantity: number;
  unit_price: number;
  orders: { placed_at: string; bar_ticket_number: number | null } | null;
  dishes: {
    name: string;
    photo_urls: string[];
    prep_time_minutes: number | null;
    rating_avg: number | null;
    rating_count: number;
    feedstars_eligible: boolean;
  } | null;
  dish_size_options: { name: string } | null;
  order_item_modifiers: { dish_modifier_options: { name: string } | null }[] | null;
}

interface OrderFocusRequest {
  orderId: string | null;
  orderItemId: string | null;
}

const HIGHLIGHT_DURATION_MS = 4000;

export function OrderTracker({ focusRequest, onFocusHandled }: { focusRequest?: OrderFocusRequest | null; onFocusHandled?: () => void }) {
  const { t } = useI18n();
  const sessionId = useTableSessionStore((s) => s.sessionId);
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Items this diner just cancelled themselves in this mount stay visible
  // with a "cancelled" confirmation label (see OrderItemCard) instead of
  // vanishing the moment the post-cancel refetch replaces `items` — kept
  // separately from `items` itself since that state gets fully overwritten
  // on every fetchItems() call.
  const [justCancelledIds, setJustCancelledIds] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Personal greeting shown once above the whole list (not per card, unlike
  // the mockup's single-order screen) — this is the diner's own tracker, so
  // one welcome per visit reads naturally without repeating for every item
  // in a multi-dish order. Same fetch pattern as BurgerSideMenu.tsx's own
  // display-name lookup: user_profiles.display_name, first word only, with
  // the same email-prefix fallback for the (should-be-impossible per
  // project_no_anonymous_diners) case a profile row is somehow missing.
  const [firstName, setFirstName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: current } = await supabase.auth.getUser();
      if (!current.user) return;
      const { data: profile } = await supabase.from('user_profiles').select('display_name').eq('user_id', current.user.id).maybeSingle();
      const name = profile?.display_name ?? current.user.email?.split('@')[0] ?? null;
      if (!cancelled) setFirstName(name ? name.trim().split(/\s+/)[0] : null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  const fetchItems = useCallback(async () => {
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('order_items')
      .select(
        'id, order_id, status, status_updated_at, quantity, unit_price, orders!inner(placed_at, bar_ticket_number), dishes!inner(name, photo_urls, prep_time_minutes, rating_avg, rating_count, feedstars_eligible), dish_size_options(name), order_item_modifiers(dish_modifier_options(name))',
      )
      .eq('orders.session_id', sessionId)
      .returns<RawOrderItemRow[]>();

    const mapped: TrackedItem[] = (data ?? [])
      .filter((row) => row.orders && row.dishes)
      .map((row) => ({
        id: row.id,
        orderId: row.order_id,
        status: row.status,
        statusUpdatedAt: row.status_updated_at,
        quantity: row.quantity,
        unitPrice: row.unit_price,
        placedAt: row.orders!.placed_at,
        dishName: row.dishes!.name,
        dishPhoto: row.dishes!.photo_urls[0] ?? null,
        sizeName: row.dish_size_options?.name ?? null,
        modifierSummary: (row.order_item_modifiers ?? [])
          .map((m) => m.dish_modifier_options?.name)
          .filter((n): n is string => !!n)
          .join(', '),
        prepTimeMinutes: row.dishes!.prep_time_minutes,
        ratingAvg: row.dishes!.rating_avg,
        ratingCount: row.dishes!.rating_count,
        feedstarsEligible: row.dishes!.feedstars_eligible,
        barTicketNumber: row.orders!.bar_ticket_number,
      }))
      .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());

    setItems(mapped);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // A tap on a notification in the bell (2026-09-19) — a cancellation names
  // its order_item directly (and must be force-shown even though it's
  // cancelled, same escape hatch as justCancelledIds above); a new-order
  // notification names the whole order instead, so find whichever of that
  // order's items is present.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.orderItemId) {
      setHighlightedId(focusRequest.orderItemId);
      setJustCancelledIds((prev) => new Set(prev).add(focusRequest.orderItemId!));
    } else if (focusRequest.orderId) {
      const match = items.find((i) => i.orderId === focusRequest.orderId);
      if (match) setHighlightedId(match.id);
    }
    onFocusHandled?.();
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // API Specification §3's own documented example, followed verbatim: a
  // participant subscribes to every order_items UPDATE for this session's
  // orders, so every participant at the table sees the whole table's status
  // changes live (Phase 1's session-wide read policy is what makes this
  // legal to even query in the first place). Known accepted gap: an order
  // placed by someone else *after* this mount isn't picked up by this
  // specific filter (built from the order IDs seen at mount time) until the
  // tab is revisited — remounting on every tab switch (this component isn't
  // kept alive across tabs) keeps that window small in practice.
  useEffect(() => {
    if (!sessionId || items.length === 0) return;
    const orderIds = [...new Set(items.map((i) => i.orderId))];
    const channel = supabase
      .channel('order-status-' + sessionId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items', filter: `order_id=in.(${orderIds.join(',')})` },
        () => void fetchItems(),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, items.length > 0]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.royalBlue} />
      </View>
    );
  }

  const visibleItems = items.filter((i) => i.status !== 'cancelled' || justCancelledIds.has(i.id));

  return (
    <View className="flex-1">
      {visibleItems.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-sm text-[#9CA3AF]">{t('ordersEmpty')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
          {firstName && (
            // Ink-dark, not the royalBlue accent reserved for prices/CTAs
            // elsewhere in this file — matches how the app renders every
            // other prominent name/title (e.g. BurgerSideMenu's own
            // display-name line), corrected 2026-09-19 after the blue
            // version read as visually inconsistent with the rest of the
            // app's type treatment.
            <Text className="mb-2 text-lg font-bold text-[#1B2430]">{t('orderGreetingLabel').replace('{name}', firstName)}</Text>
          )}
          {visibleItems.map((item) => (
            <OrderItemCard
              key={item.id}
              item={item}
              highlighted={item.id === highlightedId}
              onCancelled={(id) => setJustCancelledIds((prev) => new Set(prev).add(id))}
              onChanged={() => void fetchItems()}
              t={t}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
