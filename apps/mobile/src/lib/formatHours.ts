// Shared with restaurant-details.tsx (moved out 2026-11-02 so
// resolveTableToken.ts's "restaurant/bar is closed" messages can reuse the
// exact same day/time logic instead of a second copy). Sunday=0..Saturday=6,
// matching apps/web/src/screens/RestaurantDetailsForm.tsx's own DAY_KEYS
// convention — same hours JSON shape, same day order.
export const DAY_LABELS: Record<'he' | 'en', string[]> = {
  he: ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export interface HourRule {
  fromDay: number;
  toDay: number;
  open: string;
  close: string;
}

// restaurant-details.tsx's own entry point carries hours as a JSON-stringified
// route param; resolveTableToken.ts's gets them as an already-parsed object
// straight off a fetch response — two parse starting points, same shape.
export function parseHourRules(raw: string): HourRule[] {
  try {
    const parsed = JSON.parse(raw) as { rules?: HourRule[] } | null;
    return parsed?.rules ?? [];
  } catch {
    return [];
  }
}

export function rulesFromHours(hours: unknown): HourRule[] {
  const rules = (hours as { rules?: HourRule[] } | null)?.rules;
  return Array.isArray(rules) ? rules : [];
}

export function formatRuleLine(rule: HourRule, dayLabels: string[]): string {
  const days = rule.fromDay === rule.toDay ? dayLabels[rule.fromDay] : `${dayLabels[rule.fromDay]}-${dayLabels[rule.toDay]}`;
  return `${days} ${rule.open}-${rule.close}`;
}

export const SATURDAY = 6;

export function ruleCoversDay(rule: HourRule, day: number): boolean {
  return rule.fromDay <= rule.toDay ? day >= rule.fromDay && day <= rule.toDay : day >= rule.fromDay || day <= rule.toDay;
}

// JS Date.getDay() returns 0=Sunday..6=Saturday — the exact same convention
// this project's hours JSON already uses, so no conversion is needed to
// find "today"'s rule(s).
//
// Used to force "closed" on Saturday for every certified restaurant
// regardless of what was actually stored in `hours` (Content Guidelines/
// Backend Schema §1.3) — dropped 2026-11-21 (real feature, explicit user
// request): a certified restaurant can now configure real Saturday-evening
// hours (מוצאי שבת), enforced server-side by the restaurant's own
// kosher_saturday_earliest_open floor (see
// 20261121110000_kosher_saturday_evening_hours.sql) — whatever ends up
// stored in `rules` for Saturday is ALREADY compliant by the time it
// reaches this display layer, the same as every other day, so there is
// nothing left for `isCertified` to override here. Both functions below
// no longer take it.
export function getTodayHourLines(rules: HourRule[]): string[] {
  const today = new Date().getDay();
  return rules.filter((r) => ruleCoversDay(r, today)).map((r) => `${r.open}-${r.close}`);
}

export function getWeekHourLines(rules: HourRule[], dayLabels: string[]): string[] {
  return rules.map((r) => formatRuleLine(r, dayLabels));
}
