import { AppHeader, HeaderBellIcon, HeaderMailIcon, HeaderMenu } from './AppHeader';
import { BurgerMenuButton } from './BurgerSideMenu';
import { FeedbookWordmark } from './FeedbookWordmark';

// Shared by every screen in the (ordering) tab group — the dual header-icon
// convention confirmed against the Stage 5 mockups (7.1, 7.2, 9), corrected
// 2026-09-13 after direct user testing: bell+mail sit with "⋮" on one side
// (bell closest to center, matching the mockup's pixel order), the new
// BurgerMenuButton sits right of the Feedbook wordmark on the other side
// (not left of it) — extracted here once all three screens needed the
// identical block, to avoid the three copies drifting apart again. The
// actual slide-out panel it opens (BurgerSideMenuPanel) is rendered
// separately at the screen level via OrderingChrome, not here — see that
// file's comment for why.
export function OrderingHeader({ onNavigateToOrder }: { onNavigateToOrder?: (target: { orderId: string | null; orderItemId: string | null }) => void }) {
  return (
    <AppHeader
      left={
        <>
          <HeaderBellIcon onNavigate={onNavigateToOrder} />
          <HeaderMailIcon />
          <HeaderMenu />
        </>
      }
      right={
        <>
          <BurgerMenuButton />
          <FeedbookWordmark size={20} />
        </>
      }
    />
  );
}
