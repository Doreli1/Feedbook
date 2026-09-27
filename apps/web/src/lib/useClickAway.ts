import { useEffect, type RefObject } from 'react';

// Closes an open dropdown/menu when the user clicks (or taps) outside of it.
// Shared by TopBar's notification bell and account menu — both are simple
// toggle-open panels, not a full popover library.
export function useClickAway(ref: RefObject<HTMLElement | null>, onAway: () => void) {
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [ref, onAway]);
}
