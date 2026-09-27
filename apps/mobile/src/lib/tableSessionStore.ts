import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Populated once, right after join-session succeeds (add-participants.tsx),
// and read from any screen in the (ordering) tab group — the "ניהול חשבון"
// tab needs this data without the diner ever seeing an intermediate
// confirmation screen, and switching tabs (OrderingTabBar) carries no route
// params of its own.
//
// Persisted to AsyncStorage (2026-09-14, real bug found on a real device):
// this used to be plain in-memory. Switching language (he/en) forces a real
// native reload (I18nManager.forceRTL only takes effect after one — see
// _layout.tsx's own comment on this constraint), which wiped an in-memory
// store immediately, throwing the diner out of a live table session and
// back to /profile just for changing a display preference — not because
// their visit actually ended. Persisting survives that reload. A residual,
// accepted gap: if the app is later relaunched much later after a real
// visit ended (not just a language-triggered reload), OrderingChrome's own
// guard only catches a genuinely-empty store, not stale-but-present values
// from an old visit — resolving that fully would need real staff-side
// session-closed tracking (Stage 6 territory), not something to build here.
interface TableSessionState {
  // The real DB identifiers — added 2026-09-14 alongside Stage 5's ordering
  // Edge Functions (place-order/update-order-item/call-waiter), none of
  // which can be called with only the display strings below.
  sessionId: string | null;
  participantId: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  tableNumber: string | null;
  sessionAccountNumber: string | null;
  subAccountNumber: string | null;
  reviewVerificationCode: string | null;
  // Persisted storage is read back asynchronously (a promise, not ready on
  // the very first synchronous render after a reload) — OrderingChrome's
  // "no session data, redirect to /profile" guard must wait for this to
  // flip true before trusting a null value, or it would misfire during the
  // brief window right after every reload, including this exact
  // language-switch one.
  hasHydrated: boolean;
  setTableSession: (data: {
    sessionId: string;
    participantId: string;
    restaurantId: string;
    restaurantName: string;
    tableNumber: string;
    sessionAccountNumber: string;
    subAccountNumber: string;
    reviewVerificationCode: string;
  }) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export const useTableSessionStore = create<TableSessionState>()(
  persist(
    (set) => ({
      sessionId: null,
      participantId: null,
      restaurantId: null,
      restaurantName: null,
      tableNumber: null,
      sessionAccountNumber: null,
      subAccountNumber: null,
      reviewVerificationCode: null,
      hasHydrated: false,
      setTableSession: (data) => set(data),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'feedbook-table-session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => {
        const { sessionId, participantId, restaurantId, restaurantName, tableNumber, sessionAccountNumber, subAccountNumber, reviewVerificationCode } = state;
        return { sessionId, participantId, restaurantId, restaurantName, tableNumber, sessionAccountNumber, subAccountNumber, reviewVerificationCode };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
