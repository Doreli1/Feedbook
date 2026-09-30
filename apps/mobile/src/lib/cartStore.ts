import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// The diner's pending order — items added on the Menu tab but not yet sent
// via place-order. Persisted (same persist + hasHydrated shape as
// tableSessionStore.ts) so a mid-order app background/reload — including
// the language-switch native reload documented on that store — never
// silently drops what someone was about to order.
// Bare id replaced by a {modifierOptionId, servingVariantId} pair
// (2026-09-29) — a selected modifier option can optionally carry which
// bottle/draft(+size) format the diner chose for it (null when the option
// has no such choice at all).
export interface CartModifierSelection {
  modifierOptionId: string;
  servingVariantId: string | null;
}

export interface CartLineItem {
  id: string;
  dishId: string;
  dishName: string;
  quantity: number;
  sizeOptionId: string | null;
  sizeOptionName: string | null;
  modifierSelections: CartModifierSelection[];
  modifierSummary: string;
  unitPrice: number;
}

interface CartState {
  items: CartLineItem[];
  hasHydrated: boolean;
  addItem: (item: Omit<CartLineItem, 'id'>) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      hasHydrated: false,
      addItem: (item) =>
        set((state) => ({
          items: [...state.items, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }],
        })),
      removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'feedbook-cart',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

export function cartTotal(items: CartLineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}
