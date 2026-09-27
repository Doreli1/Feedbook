import { OrderingScreen } from '../../src/components/OrderingScreen';

// The only route in the (ordering) group — see OrderingScreen.tsx's own
// comment for why /orders and /account no longer exist as separate routes
// (2026-09-14: a genuinely seamless tab switch needed one screen managing
// all three tabs as internal state, not three routes swapped via
// router.replace()). Kept at this path since add-participants.tsx and
// table-session.tsx already push here after join-session succeeds.
export default OrderingScreen;
