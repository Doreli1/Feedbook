import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Restaurant } from '@feedbook/types';
import { AppHeader } from '../components/AppHeader';
import { DashboardShell, type DashboardTab } from '../components/DashboardShell';
import { MenuManager } from '../components/MenuManager';
import { ProfitabilityCard } from '../components/ProfitabilityCard';
import { OverheadExpensesForm } from '../components/OverheadExpensesForm';
import { IngredientsScreen } from './IngredientsScreen';
import { KitchenScreen } from './KitchenScreen';
import { PurchaseOrdersScreen } from './PurchaseOrdersScreen';
import { UsersScreen } from './UsersScreen';
import { TableManagerContent } from './TableManagerForm';
import { useMenu } from '../lib/useMenu';
import { useInventory } from '../lib/useInventory';
import { useOrders } from '../lib/useOrders';
import { useWaiterCalls } from '../lib/useWaiterCalls';
import { useStaff } from '../lib/useStaff';
import { useTables } from '../lib/useTables';
import { useOverheadExpenses } from '../lib/useOverheadExpenses';
import { useNotifications } from '../lib/useNotifications';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

// Which tab a notification's unread count should surface on — every
// notification inserted today is type='order_status' (see
// 20260919120000_order_event_notifications.sql), all destined for the
// "orders" tab, but this stays a mapping (not a hardcoded single tab) so a
// future notification type (e.g. a review-ready alert) doesn't silently
// need this rewritten — it just needs a new case here.
const NOTIFICATION_TYPE_TAB: Record<string, DashboardTab> = {
  order_status: 'orders',
  waiter_ack: 'orders',
  inventory_alert: 'inventory',
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  draft: 'statusDraft',
  pending_review: 'statusPendingReview',
  approved: 'statusApproved',
  rejected: 'statusRejected',
};

interface Props {
  session: Session;
  restaurant: Restaurant;
  restaurants: Restaurant[];
  onSwitchRestaurant: (id: string) => void;
  onAddRestaurant: () => void;
  onEditDetails: () => void;
}

export function Dashboard({ session, restaurant, restaurants, onSwitchRestaurant, onAddRestaurant, onEditDetails }: Props) {
  const { t } = useI18n();

  // A draft/pending/rejected restaurant has no live operations to manage
  // yet — full management nav would be misleading before approval.
  if (restaurant.onboarding_status !== 'approved') {
    return (
      <div className="min-h-screen bg-background px-6 py-4">
        <AppHeader
          restaurantName={restaurant.name}
          restaurantAddress={restaurant.address ?? undefined}
          restaurants={restaurants}
          activeRestaurantId={restaurant.id}
          onSwitchRestaurant={onSwitchRestaurant}
          onAddRestaurant={onAddRestaurant}
        />
        <div className="flex flex-col items-center justify-center py-16">
          <p className="mb-2 text-sm text-muted-foreground">{t('signedInAs')}</p>
          <p className="mb-1 text-lg font-semibold text-ink">{session.user.email}</p>
          <p className="mb-6 text-xs text-muted-foreground">{t(STATUS_KEYS[restaurant.onboarding_status] ?? 'statusDraft')}</p>
          <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">{t('dashboardComingSoon')}</p>
          <button onClick={onEditDetails} className="mb-3 rounded border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2">
            {t('editRestaurantDetails')}
          </button>
          <button
            onClick={() => void supabase.auth.signOut()}
            className="rounded border border-danger px-4 py-2 text-sm text-danger hover:bg-danger-soft"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <ApprovedDashboard
      session={session}
      restaurant={restaurant}
      restaurants={restaurants}
      onSwitchRestaurant={onSwitchRestaurant}
      onAddRestaurant={onAddRestaurant}
      onEditDetails={onEditDetails}
    />
  );
}

function ApprovedDashboard({
  session,
  restaurant,
  restaurants,
  onSwitchRestaurant,
  onAddRestaurant,
  onEditDetails,
}: {
  session: Session;
  restaurant: Restaurant;
  restaurants: Restaurant[];
  onSwitchRestaurant: (id: string) => void;
  onAddRestaurant: () => void;
  onEditDetails: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DashboardTab>('overview');
  const { categories, dishes, dishIngredients, dishSizeOptions, refresh: refreshMenu } = useMenu(restaurant.id);
  const { ingredients, purchaseOrders, refresh: refreshInventory } = useInventory(restaurant.id);
  const { expenses: overheadExpenses, totalMonthlyOverhead, dishesSoldInWindow, saveExpenses: saveOverheadExpenses } = useOverheadExpenses(restaurant.id);
  const { items: orderItems, refresh: refreshOrders } = useOrders(restaurant.id);
  const { calls: waiterCalls, refresh: refreshWaiterCalls, acknowledge: acknowledgeWaiterCall } = useWaiterCalls(restaurant.id);
  const { staff, refresh: refreshStaff } = useStaff(restaurant.id);
  const { tables, refresh: refreshTables } = useTables(restaurant.id);
  const { notifications: staffNotifications, markRead: markNotificationRead } = useNotifications(restaurant.id, session.user.id);
  // Set when a notification is clicked, so KitchenScreen knows which
  // section to jump to and which row to highlight — cleared once it's
  // acted on (KitchenScreen calls onFocusHandled), so clicking the *same*
  // notification again still re-triggers the focus even if the section
  // was already correct.
  const [kitchenFocus, setKitchenFocus] = useState<{ orderId: string | null; orderItemId: string | null } | null>(null);

  const lowStock = ingredients.filter((i) => i.quantity_in_stock < i.threshold_quantity);
  // Low-stock alerts have no persisted row/read-column of their own (see the
  // `notifications` construction below) — they're a live-computed condition,
  // not an event, so there's nothing in the database to mark read. But
  // clicking one and having it still look "unread" right after reads as
  // broken (reported 2026-09-20, right after the click-to-navigate fix
  // shipped) — this is a session-local "seen it" set, purely for the bell
  // dropdown's own read/unread styling. It intentionally does NOT affect
  // the inventory tab's own badge count (lowStockCount) or the Overview
  // list below: the ingredient is still genuinely low on stock regardless
  // of whether anyone acknowledged the alert about it.
  const [acknowledgedLowStockIds, setAcknowledgedLowStockIds] = useState<Set<string>>(new Set());

  // A live-computed condition (see above) has no `sent_at` of its own to
  // sort by, unlike staffNotifications' real DB rows — so without this, the
  // bell's merged list below could only ever put "all low-stock alerts"
  // above or below "all staff notifications" as two fixed blocks, never a
  // single true newest-first stack across both kinds (reported 2026-09-23:
  // "כל הגדרה חדשה בפעמון... תמיד תופיע בראש הרשימה"). Session-local record
  // of when THIS tab first noticed each currently-low ingredient, so it can
  // be given a real sort position among the persisted notifications; cleared
  // the moment an ingredient leaves the low-stock set, so if it dips low
  // again later it's treated as a fresh occurrence and jumps back to the top.
  const [lowStockDetectedAt, setLowStockDetectedAt] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    setLowStockDetectedAt((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const i of lowStock) {
        if (!next.has(i.id)) {
          next.set(i.id, Date.now());
          changed = true;
        }
      }
      for (const id of Array.from(next.keys())) {
        if (!lowStock.some((i) => i.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowStock]);

  // API Specification §3 — documented Realtime channel for the low-stock
  // alert, instead of hand-rolled polling: the client still filters
  // client-side (Supabase Realtime postgres_changes filters support a single
  // column comparison, not "column < other column"), but subscribing means
  // the Overview list updates the moment stock changes anywhere, including
  // from another staff member's screen.
  useEffect(() => {
    const channel = supabase
      .channel(`ingredients-${restaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients', filter: `restaurant_id=eq.${restaurant.id}` }, () =>
        void refreshInventory(),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [restaurant.id, refreshInventory]);

  // order_items/waiter_calls carry no restaurant_id column of their own (only
  // a session_id → table_sessions.restaurant_id path), so a postgres_changes
  // filter can't scope by restaurant server-side the way the ingredients
  // channel above does. Subscribing unfiltered still only ever delivers rows
  // this restaurant's own staff_manage_own_restaurant_* SELECT policy allows
  // — RLS gates Realtime payload delivery the same way it gates a plain
  // query, confirmed while researching Stage 5's kitchen screen — so this is
  // the correct mechanism here, not a stand-in for a missing filter.
  useEffect(() => {
    const channel = supabase
      .channel(`kitchen-${restaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => void refreshOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, () => void refreshWaiterCalls())
      .subscribe();
    return () => void supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant.id, refreshOrders, refreshWaiterCalls]);

  // Two different kinds of "notification" share one bell: low-stock alerts
  // are a live-computed, always-current *condition* (they simply exist as
  // long as stock stays low, same as before this feature existed), not a
  // persisted event — there's no `notifications` row and no DB read-column
  // to mark. Order placed/cancelled events are real persisted rows
  // (useNotifications.ts) with their own read state, newest first; each is
  // marked read individually on click, never all at once on opening the
  // bell (per explicit answer when this was scoped).
  //
  // Both kinds navigate AND visually mark-read on click, though (fixed
  // 2026-09-20 across two follow-up reports): a low-stock row originally
  // shipped with neither, rendering as an inert <div> in TopBar's dropdown
  // (`n.onClick ? <button> : <div>`) — fixed by adding onClick. Clicking it
  // still left it looking permanently unread, since there was nowhere to
  // record that — fixed with `acknowledgedLowStockIds`, a session-local set
  // that only drives this dropdown row's read styling and the bell's own
  // unread count. It deliberately leaves lowStockCount (the inventory tab's
  // badge) and the Overview list alone — the ingredient is still genuinely
  // low on stock regardless of whether anyone's seen the alert about it.
  // Merged into one true "newest first" stack (2026-09-23) — regardless of
  // type or which tab it belongs to, a brand-new notification always sorts
  // above older ones from either source. staffNotifications carry a real
  // `sentAt`; low-stock alerts use the session-local detection time recorded
  // above, since they have no DB timestamp of their own.
  const notifications = [
    ...staffNotifications.map((n) => ({
      id: n.id,
      title: n.title,
      subtitle: n.body,
      read: n.readAt !== null,
      sortKey: new Date(n.sentAt).getTime(),
      onClick: () => {
        void markNotificationRead(n.id);
        if (n.relatedOrderId || n.relatedOrderItemId) {
          setTab('orders');
          setKitchenFocus({ orderId: n.relatedOrderId, orderItemId: n.relatedOrderItemId });
        }
      },
    })),
    ...lowStock.map((i) => ({
      id: i.id,
      title: i.name,
      subtitle: t('lowStockNotificationSubtitle')
        .replace('{stock}', String(i.quantity_in_stock))
        .replace('{threshold}', String(i.threshold_quantity))
        .replace('{unit}', i.unit),
      read: acknowledgedLowStockIds.has(i.id),
      sortKey: lowStockDetectedAt.get(i.id) ?? Date.now(),
      onClick: () => {
        setAcknowledgedLowStockIds((prev) => new Set(prev).add(i.id));
        setTab('inventory');
      },
    })),
  ].sort((a, b) => b.sortKey - a.sortKey);

  // Low-stock's own count already has its own long-standing warning pill on
  // the inventory tab (above) — this is only the unread persisted-
  // notification count, so the two never double up on the same tab.
  const tabNotificationCounts = staffNotifications.reduce<Partial<Record<DashboardTab, number>>>((acc, n) => {
    if (n.readAt !== null) return acc;
    const tab = NOTIFICATION_TYPE_TAB[n.type];
    if (!tab) return acc;
    acc[tab] = (acc[tab] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <DashboardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      activeTab={tab}
      onTabChange={setTab}
      lowStockCount={lowStock.length}
      tabNotificationCounts={tabNotificationCounts}
      notifications={notifications}
      onSignOut={() => void supabase.auth.signOut()}
      onEditDetails={onEditDetails}
      restaurants={restaurants}
      activeRestaurantId={restaurant.id}
      onSwitchRestaurant={onSwitchRestaurant}
      onAddRestaurant={onAddRestaurant}
    >
      {tab === 'overview' && (
        <div className="space-y-4">
          <ProfitabilityCard
            dishes={dishes}
            dishIngredients={dishIngredients}
            ingredients={ingredients}
            vatRatePercent={restaurant.vat_rate_percent}
            totalMonthlyOverhead={totalMonthlyOverhead}
            dishesSoldInWindow={dishesSoldInWindow}
          />

          <OverheadExpensesForm expenses={overheadExpenses} onSave={saveOverheadExpenses} />

          <div className="card p-6">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t('lowStockAlertsHeading')}</h2>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('lowStockAlertsEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {lowStock.map((i) => (
                  <div key={i.id} className="flex items-center justify-between rounded bg-surface-2 px-3 py-2 text-sm">
                    <span className="font-medium text-ink">{i.name}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {i.quantity_in_stock} / {i.threshold_quantity} {i.unit}
                    </span>
                  </div>
                ))}
                <button onClick={() => setTab('inventory')} className="text-xs font-medium text-accent hover:underline">
                  {t('goToInventory')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'menu' && (
        <div className="card p-6">
          <MenuManager
            restaurantId={restaurant.id}
            categories={categories}
            dishes={dishes}
            dishSizeOptions={dishSizeOptions}
            ingredients={ingredients}
            onRefresh={refreshMenu}
          />
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-4">
          <IngredientsScreen
            restaurantId={restaurant.id}
            ingredients={ingredients}
            onRefresh={refreshInventory}
            alertIngredientIds={new Set(lowStock.map((i) => i.id))}
          />
          <PurchaseOrdersScreen restaurantId={restaurant.id} ingredients={ingredients} purchaseOrders={purchaseOrders} onRefresh={refreshInventory} />
        </div>
      )}

      {tab === 'orders' && (
        <KitchenScreen
          restaurantId={restaurant.id}
          items={orderItems}
          waiterCalls={waiterCalls}
          onRefreshOrders={refreshOrders}
          onAcknowledgeCall={(id) => void acknowledgeWaiterCall(id)}
          focusRequest={kitchenFocus}
          onFocusHandled={() => setKitchenFocus(null)}
        />
      )}

      {tab === 'tables' && (
        <TableManagerContent restaurant={restaurant} tables={tables} onRefresh={refreshTables} />
      )}

      {tab === 'team' && <UsersScreen session={session} restaurantId={restaurant.id} staff={staff} onRefresh={refreshStaff} />}
    </DashboardShell>
  );
}
