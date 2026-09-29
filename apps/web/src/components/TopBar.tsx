import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Restaurant } from '@feedbook/types';
import { FeedbookBrand } from './FeedbookBrand';
import { LanguageToggle } from './LanguageToggle';
import { ConfirmDialog } from './ConfirmDialog';
import { Tooltip } from './Tooltip';
import { BellIcon, EnvelopeIcon, UserIcon } from './Icons';
import { useClickAway } from '../lib/useClickAway';
import { useI18n } from '../lib/i18n';

export interface TopBarNotification {
  id: string;
  title: string;
  subtitle?: string;
  // Omitted (e.g. the live-computed low-stock alerts on Dashboard.tsx, which
  // have no read/unread concept of their own — they simply exist as long as
  // stock stays low) counts as unread and renders as a plain, non-clickable
  // row, same as before this feature existed. When present, this is a real
  // persisted notification (useNotifications.ts): `read` drives its visual
  // weight and whether it still counts toward the bell's badge number, and
  // `onClick` marks it read — each notification is marked individually, per
  // the user's explicit answer, never all-at-once on opening the bell.
  read?: boolean;
  onClick?: () => void;
}

interface Props {
  restaurantName?: string;
  restaurantAddress?: string;
  // Account menu + notification bell only render in "Dashboard mode" —
  // gated on onSignOut being passed, since the registration wizard (which
  // shares this same bar via WizardShell) has no account menu of its own,
  // sign-out there is a plain in-content button. Consolidates what used to
  // be loose buttons in the Dashboard body (Booking-extranet-style: account
  // details live behind the person icon, not scattered on the page).
  onSignOut?: () => void;
  onEditDetails?: () => void;
  restaurants?: Restaurant[];
  activeRestaurantId?: string;
  onSwitchRestaurant?: (id: string) => void;
  onAddRestaurant?: () => void;
  notifications?: TopBarNotification[];
  // Only set when there's somewhere real to go back to (e.g. the wizard was
  // opened to add an additional restaurant, and at least one other already
  // exists) — never for a genuine first-time signup, where the wizard IS the
  // only path forward and a "way out" would just strand the user mid-air.
  onLogoClick?: () => void;
}

export function TopBar({
  restaurantName,
  restaurantAddress,
  onSignOut,
  onEditDetails,
  restaurants,
  activeRestaurantId,
  onSwitchRestaurant,
  onAddRestaurant,
  notifications = [],
  onLogoClick,
}: Props) {
  const showAccountMenu = !!onSignOut;

  return (
    <header dir="ltr" className="flex items-center justify-between gap-4 bg-chrome px-6 py-3 sm:px-12">
      {onLogoClick ? (
        <button type="button" onClick={onLogoClick} className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          <FeedbookBrand onDark />
        </button>
      ) : (
        <FeedbookBrand onDark />
      )}
      <div className="flex min-w-0 items-center gap-2">
        {restaurantName && !showAccountMenu && (
          <div dir="auto" className="max-w-[220px] text-right">
            <p className="truncate text-sm font-medium text-white">{restaurantName}</p>
            {restaurantAddress && <p className="truncate text-xs text-white/70">{restaurantAddress}</p>}
          </div>
        )}
        {showAccountMenu && (
          <>
            <NotificationBell notifications={notifications} />
            <EnvelopeButton />
            <AccountMenu
              restaurantName={restaurantName}
              restaurantAddress={restaurantAddress}
              restaurants={restaurants}
              activeRestaurantId={activeRestaurantId}
              onSwitchRestaurant={onSwitchRestaurant}
              onAddRestaurant={onAddRestaurant}
              onEditDetails={onEditDetails}
              onSignOut={onSignOut!}
            />
          </>
        )}
        <LanguageToggle onDark placement="bottom" />
      </div>
    </header>
  );
}

// Placeholder (2026-09-20): the mobile app's own header already has this
// same envelope icon next to its bell (OrderingHeader.tsx — bell for the
// diner's own order events, mail reserved for account/promo messages). On
// this side it's meant to serve "every kind of message/request a diner
// sends the restaurant" — a feature not built yet, so this renders the icon
// only, with no click behavior, dropdown, or badge until that's defined.
function EnvelopeButton() {
  const { t } = useI18n();
  return (
    // placement="bottom" — this sits in the header bar, at the very top of
    // the page, so the default upward-opening bubble had nowhere to go and
    // got clipped by the top of the browser window (reported 2026-09-24,
    // same root cause as the language toggle just below).
    <Tooltip
      placement="bottom"
      content={
        <div>
          <p className="mb-1 font-bold text-ink">{t('envelopeMessagesTitle')}</p>
          <p>{t('envelopeComingSoon')}</p>
        </div>
      }
    >
      <button
        type="button"
        aria-label={t('envelopeComingSoon')}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
      >
        <EnvelopeIcon className="h-5 w-5" />
      </button>
    </Tooltip>
  );
}

function NotificationBell({ notifications }: { notifications: TopBarNotification[] }) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Panel + backdrop are portaled to document.body (2026-09-24), computed
  // from the bell button's own bounding rect, rather than a plain CSS
  // `absolute` dropdown nested in the header. Two reasons: (1) the dimming
  // backdrop needs to cover the entire page, which a header-scoped element
  // can't reliably guarantee stacks above every other part of the app
  // regardless of ancestor stacking contexts; (2) with the backdrop in
  // place, "click outside closes it" is just the backdrop's own onClick —
  // simpler and safer than useClickAway's DOM-containment check, which
  // would otherwise misfire on every click *inside* a portaled panel (it
  // checks real DOM containment, and a portaled panel is a React-tree child
  // but not a DOM child of the bell's own wrapper).
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    // `document.documentElement.clientWidth`, not `window.innerWidth` — the
    // latter includes the vertical scrollbar's own width, so on any page
    // with a scrollbar this silently shifted the panel a scrollbar-width's
    // worth away from true alignment with the button (reported 2026-09-24:
    // the triangle looked close but not exactly centered under the bell).
    // clientWidth excludes the scrollbar, matching the coordinate space
    // getBoundingClientRect() already reports in.
    const viewportWidth = document.documentElement.clientWidth;
    setCoords({ top: rect.bottom + 8, right: viewportWidth - rect.right });
  }, [open]);

  return (
    // z-50 keeps the bell itself clickable (to toggle closed again) above
    // the backdrop's z-40 — otherwise the backdrop, sitting on top in paint
    // order once open, would intercept that second click before it ever
    // reaches the button.
    <div className="relative z-50">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notificationsTitle')}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
      >
        {/* `relative` moved from the h-8/w-8 button onto this icon-sized
            span (2026-09-20) — the badge was anchored to the button's own
            larger box, which still left visible padding between it and the
            icon. Anchoring to the icon's own bounding box instead pulls it
            genuinely flush. */}
        <span className="relative inline-flex">
          <BellIcon className="h-5 w-5" />
          {unreadCount > 0 && (
            // Physical top-left of the icon (was top-right) — matches the
            // mobile app's own badge convention (HeaderMailIcon's unread dot
            // sits at "-end-0.5 -top-0.5", i.e. the physical left under its
            // forced RTL), per the reference screenshot the user sent
            // (2026-09-20).
            <span className="absolute -left-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-chrome bg-danger px-1 text-[10px] font-bold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
      </button>
      {open &&
        coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40 bg-black/5" onClick={() => setOpen(false)} />
            {/* `right: coords.right` is measured the same way the button's
                own bounding rect is (distance from the viewport's physical
                right edge), so the panel's right edge lands exactly where
                the old `right-0` (relative to a wrapper exactly as wide as
                the button) used to — and the button is 32px wide, so its own
                center sits exactly 16px in from that edge, which is what the
                triangle below centers on. */}
            <div
              dir={dir}
              style={{ position: 'fixed', top: coords.top, right: coords.right }}
              className="z-50 w-72 rounded-xl border border-border bg-surface text-start shadow-lg"
            >
              {/* Physical `right-4`/`border-r`, not the logical `end`/`border-e`
                  — this panel is pinned by a physical viewport offset (see
                  above), so a logical border would silently drift the seam
                  off the corner once the app switches to Hebrew (RTL flips
                  border-e to the physical left, but the panel never moves).
                  `translate-x-1/2` re-centers the triangle's own midpoint
                  exactly on that 16px point, the same way FieldLabel's bubble
                  centers its tail with `left-1/2 -translate-x-1/2` — right-4
                  alone would only align the triangle's edge there, landing
                  its visual tip off-center by half its own width. */}
              <span className="absolute -top-1.5 right-4 h-3 w-3 translate-x-1/2 rotate-45 rounded-[2px] border-r border-t border-border bg-neutral-100 dark:bg-neutral-600" />
              <div className="rounded-t-xl border-b border-border bg-neutral-100 px-3.5 py-2.5 text-sm font-bold text-ink dark:bg-neutral-600">
                {t('notificationsTitle')}
              </div>
              {notifications.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{t('notificationsEmpty')}</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {notifications.map((n) => {
                    const content = (
                      <>
                        <div className="flex items-start gap-2">
                          {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                          <p className={`text-sm ${n.read ? 'font-normal text-muted-foreground' : 'font-medium text-ink'}`}>{n.title}</p>
                        </div>
                        {n.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{n.subtitle}</p>}
                      </>
                    );
                    return (
                      <li key={n.id} className="border-b border-border last:border-0">
                        {n.onClick ? (
                          <button
                            type="button"
                            onClick={() => {
                              n.onClick?.();
                              setOpen(false);
                            }}
                            className="block w-full px-3 py-2.5 text-start hover:bg-surface-2"
                          >
                            {content}
                          </button>
                        ) : (
                          <div className="px-3 py-2.5">{content}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function AccountMenu({
  restaurantName,
  restaurantAddress,
  restaurants,
  activeRestaurantId,
  onSwitchRestaurant,
  onAddRestaurant,
  onEditDetails,
  onSignOut,
}: {
  restaurantName?: string;
  restaurantAddress?: string;
  restaurants?: Restaurant[];
  activeRestaurantId?: string;
  onSwitchRestaurant?: (id: string) => void;
  onAddRestaurant?: () => void;
  onEditDetails?: () => void;
  onSignOut: () => void;
}) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));

  const showSwitcher = restaurants && restaurants.length > 1;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('accountMenuTitle')}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <UserIcon className="h-[18px] w-[18px]" />
      </button>
      {open && (
        // See NotificationBell's comment: physical right-0, dir only for text flow.
        <div dir={dir} className="absolute right-0 top-10 z-30 w-64 rounded-lg border border-border bg-surface text-start shadow-lg">
          {restaurantName && (
            <div className="border-b border-border px-3 py-2.5">
              <p className="truncate text-sm font-medium text-ink">{restaurantName}</p>
              {restaurantAddress && <p className="truncate text-xs text-muted-foreground">{restaurantAddress}</p>}
            </div>
          )}

          {showSwitcher && (
            <div className="border-b border-border py-1">
              {restaurants!.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onSwitchRestaurant?.(r.id);
                    setOpen(false);
                  }}
                  className={`block w-full truncate px-3 py-2 text-start text-sm ${
                    r.id === activeRestaurantId ? 'font-semibold text-accent' : 'text-ink hover:bg-surface-2'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}

          {onAddRestaurant && (
            <button
              type="button"
              onClick={() => {
                onAddRestaurant();
                setOpen(false);
              }}
              className="block w-full border-b border-border px-3 py-2 text-start text-sm text-accent hover:bg-surface-2"
            >
              {t('addRestaurant')}
            </button>
          )}

          {onEditDetails && (
            <button
              type="button"
              onClick={() => {
                onEditDetails();
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-start text-sm text-ink hover:bg-surface-2"
            >
              {t('editRestaurantDetails')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmingSignOut(true);
            }}
            className="block w-full px-3 py-2 text-start text-sm text-danger hover:bg-danger-soft"
          >
            {t('signOut')}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmingSignOut}
        title={t('confirmSignOutTitle')}
        description={t('confirmSignOutDescription')}
        confirmLabel={t('signOut')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        onConfirm={() => {
          setConfirmingSignOut(false);
          onSignOut();
        }}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </div>
  );
}
