// Hides a trailing ".00" (2026-10-11, user request, applied across every
// screen that shows a ₪ price) — a whole-number price reads cleaner
// without it; a non-zero fractional part (e.g. ₪12.50) still keeps its two
// decimal places.
export function formatPrice(amount: number): string {
  const fixed = amount.toFixed(2);
  return fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed;
}
