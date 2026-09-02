import { useEffect, useState } from 'react';
import type { Restaurant } from '@feedbook/types';

const STORAGE_KEY = 'feedbook-active-restaurant-id';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Tracks which of the user's restaurants (there can be more than one — a
// user can be an active manager at several) is the one currently shown.
// Persisted so a reload doesn't bounce back to whichever restaurant happens
// to sort first. Defaults to the first restaurant whenever the stored id
// isn't (or is no longer) one of the user's restaurants.
export function useActiveRestaurantId(restaurants: Restaurant[]) {
  const [activeId, setActiveIdState] = useState<string | null>(readStored);

  useEffect(() => {
    const first = restaurants[0];
    if (!first) return;
    if (activeId && restaurants.some((r) => r.id === activeId)) return;
    setActiveId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants]);

  function setActiveId(id: string) {
    setActiveIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage can throw in private-browsing contexts — the choice
      // just won't persist across reloads, which is a harmless fallback.
    }
  }

  return { activeId, setActiveId };
}
