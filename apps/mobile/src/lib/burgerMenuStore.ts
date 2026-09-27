import { create } from 'zustand';

// Shared between BurgerMenuButton (lives inside OrderingHeader's small row)
// and BurgerSideMenuPanel (rendered at each screen's top level instead, so it
// can measure the real header+tab-strip height and start below them —
// see OrderingChrome.tsx).
interface BurgerMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useBurgerMenuStore = create<BurgerMenuState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
