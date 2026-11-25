import { useEffect, useState } from 'react';

// Shared by both sides of the personal-account-link request's countdown
// badge (2026-11-25, explicit user request): the approver's own accept/
// decline modal (top-left) and the sender's own pending-blocks-payment
// notice (bottom-left) — same 1-minute window the server itself enforces
// (expire_stale_billing_requests), just displayed client-side. Recomputes
// from real elapsed wall-clock time every tick (not a naive decrement), so
// it stays correct even after the screen was backgrounded for a while
// instead of silently drifting.
export function useCountdownSeconds(fromIso: string | null, totalSeconds: number): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!fromIso) {
      setRemaining(null);
      return;
    }
    const fromMs = new Date(fromIso).getTime();
    function tick() {
      const elapsed = Math.floor((Date.now() - fromMs) / 1000);
      setRemaining(Math.max(0, totalSeconds - elapsed));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [fromIso, totalSeconds]);

  return remaining;
}

// "0:45" style, not a bare seconds count — shared by both sides of the
// request's countdown badge.
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
