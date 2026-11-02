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
// isCertified forces "closed" on Saturday regardless of what's actually
// stored in hours — a kosher-certified restaurant isn't open on Shabbat
// (Content Guidelines/Backend Schema §1.3). Display-layer rule, not a DB
// constraint check here.
export function getTodayHourLines(rules: HourRule[], isCertified: boolean): string[] {
  const today = new Date().getDay();
  if (isCertified && today === SATURDAY) return [];
  return rules.filter((r) => ruleCoversDay(r, today)).map((r) => `${r.open}-${r.close}`);
}

// Same Shabbat override applied to the expanded full-week view: a rule that
// only covers Saturday is dropped, and a rule whose range ends on Saturday
// is shortened to stop at Friday — then an explicit "Saturday: closed" line
// is appended so the rule is visible, not just silently missing.
export function getWeekHourLines(rules: HourRule[], dayLabels: string[], isCertified: boolean, closedLabel: string): string[] {
  if (!isCertified) return rules.map((r) => formatRuleLine(r, dayLabels));
  const lines: string[] = [];
  for (const r of rules) {
    if (!ruleCoversDay(r, SATURDAY)) {
      lines.push(formatRuleLine(r, dayLabels));
    } else if (r.fromDay !== SATURDAY && r.fromDay <= r.toDay) {
      lines.push(formatRuleLine({ ...r, toDay: SATURDAY - 1 }, dayLabels));
    }
    // A rule that is Saturday-only, or wraps around through Saturday in a
    // shape not covered above, is dropped — the appended closed-line below
    // is the correct statement either way.
  }
  lines.push(`${dayLabels[SATURDAY]}: ${closedLabel}`);
  return lines;
}
