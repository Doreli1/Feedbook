import type { ComponentType, ReactNode } from 'react';
import type { Restaurant } from '@feedbook/types';
import { TopBar, type TopBarNotification } from './TopBar';
import { DashboardIcon, InventoryIcon, MenuTabIcon, OrdersTabIcon, TablesTabIcon, TeamTabIcon } from './Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

export type DashboardTab = 'overview' | 'menu' | 'inventory' | 'orders' | 'tables' | 'team';

const TABS: DashboardTab[] = ['overview', 'menu', 'inventory', 'orders', 'tables', 'team'];
const TAB_LABEL_KEYS: Record<DashboardTab, TranslationKey> = {
  overview: 'dashboardTabOverview',
  menu: 'dashboardTabMenu',
  inventory: 'dashboardTabInventory',
  orders: 'dashboardTabOrders',
  tables: 'dashboardTabTables',
  team: 'dashboardTabTeam',
};
// One matching icon per tab (2026-09-20), shown at the tab's physical right
// (this nav is RTL — document.documentElement.dir, see i18n.tsx — so the
// icon renders first in JSX to land there, with the label+badge group after
// it, both flowing right-to-left).
const TAB_ICONS: Record<DashboardTab, ComponentType<{ className?: string }>> = {
  overview: DashboardIcon,
  menu: MenuTabIcon,
  inventory: InventoryIcon,
  orders: OrdersTabIcon,
  tables: TablesTabIcon,
  team: TeamTabIcon,
};

interface Props {
  restaurantName: string;
  restaurantAddress?: string;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  lowStockCount: number;
  // Unread persisted-notification count per tab (see useNotifications.ts) —
  // separate from lowStockCount, which is its own long-standing, always-on
  // warning-colored pill for a continuous state, not an event count.
  // Requested 2026-09-19 right after the notification bell itself, so a
  // staff member glancing at the tab row (not just the bell) can already
  // tell which module has unread activity and how much.
  tabNotificationCounts: Partial<Record<DashboardTab, number>>;
  notifications: TopBarNotification[];
  onSignOut: () => void;
  onEditDetails: () => void;
  restaurants: Restaurant[];
  activeRestaurantId: string;
  onSwitchRestaurant: (id: string) => void;
  onAddRestaurant: () => void;
  children: ReactNode;
}

// Post-approval management shell — same full-bleed navy TopBar as the
// registration wizard, plus a horizontal module-tab row attached directly
// beneath it (Booking extranet-style: "עמוד הבית / הזמנות / פיננסי..." as one
// continuous header block, not a sidebar) instead of WizardShell's own
// step-progress bar, since Dashboard's tabs are flat destinations, not a
// completable sequence. No router: a plain active-tab useState in
// Dashboard.tsx, same "no router library" convention as the rest of the app.
export function DashboardShell({
  restaurantName,
  restaurantAddress,
  activeTab,
  onTabChange,
  lowStockCount,
  tabNotificationCounts,
  notifications,
  onSignOut,
  onEditDetails,
  restaurants,
  activeRestaurantId,
  onSwitchRestaurant,
  onAddRestaurant,
  children,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        restaurantName={restaurantName}
        restaurantAddress={restaurantAddress}
        notifications={notifications}
        onSignOut={onSignOut}
        onEditDetails={onEditDetails}
        restaurants={restaurants}
        activeRestaurantId={activeRestaurantId}
        onSwitchRestaurant={onSwitchRestaurant}
        onAddRestaurant={onAddRestaurant}
      />

      <div className="border-b border-border bg-surface px-4 sm:px-8">
        <nav className="mx-auto flex max-w-6xl gap-1">
          {TABS.map((tab) => {
            // Unified into one small badge per tab (2026-09-20) — previously
            // the inventory tab's always-on low-stock pill (warning/amber)
            // and any tab's unread-notification pill (danger/red) sat inline
            // side by side, in two different colors and sizes, which read as
            // inconsistent. Both now count toward the same red corner badge;
            // the underlying counts (and the reason for showing it) are
            // still tracked separately in state, only the display is merged.
            const badgeCount = (tab === 'inventory' ? lowStockCount : 0) + (tabNotificationCounts[tab] ?? 0);
            const TabIcon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={`flex cursor-pointer items-center gap-2 rounded-t-md border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'border-accent bg-accent-soft font-semibold text-accent'
                    : 'border-transparent text-muted-foreground hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <TabIcon className="h-4 w-4 shrink-0" />
                {/* Settled on plain inline placement (2026-09-20) after two
                    absolute-position/corner-overlay attempts (bottom-left,
                    then top-left) — the user asked instead for the badge to
                    simply sit beside the label, on its left. A normal flex
                    row, not an overlay: this label span comes first in JSX
                    and this whole nav is RTL-mirrored, so the label renders
                    at the physical right and the badge after it at the
                    physical left, with no overlap to fine-tune. */}
                <span className="flex items-center gap-1">
                  {t(TAB_LABEL_KEYS[tab])}
                  {badgeCount > 0 && (
                    <span className="flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold leading-none text-white">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
