// Validates the "bar hours must always fit inside the restaurant's general
// hours" rule (2026-11-02, user decision — reversed the earlier
// independent-bar-schedule design) at the point the owner edits them, in
// RestaurantDetailsForm.tsx. bar_is_active() already enforces this at
// runtime unconditionally (a bar rule outside the general hours simply
// never takes effect), so this validation isn't a correctness backstop —
// it's what keeps the owner from configuring a bar rule that looks saved
// but silently never activates.
export interface HourRule {
  fromDay: number;
  toDay: number;
  open: string;
  close: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function ruleCoversDay(rule: HourRule, day: number): boolean {
  return rule.fromDay <= rule.toDay ? day >= rule.fromDay && day <= rule.toDay : day >= rule.fromDay || day <= rule.toDay;
}

// Every day a rule's fromDay..toDay range touches, inclusive, walking
// forward with wraparound (fromDay=5,toDay=1 -> [5,6,0,1]).
function daysInRange(fromDay: number, toDay: number): number[] {
  const days: number[] = [];
  let d = fromDay;
  // A rule's own day-range is at most 7 days; this bound just guards
  // against a malformed fromDay/toDay (out of 0-6) looping forever.
  for (let i = 0; i < 7; i++) {
    days.push(d);
    if (d === toDay) break;
    d = (d + 1) % 7;
  }
  return days;
}

// Is this exact (day, minute-of-day) instant covered by any rule in
// `rules`? Mirrors bar_hours_active_now's own two-anchor-day approach for
// a rule whose close time wraps past midnight (close <= open): such a
// rule's coverage on `day` only starts there if `day` is itself in the
// rule's range, OR carries over from the PREVIOUS day's instance of the
// same rule if that previous day is in range and `minute` is still before
// the wrapped close time.
function isCovered(rules: HourRule[], day: number, minute: number): boolean {
  const prevDay = (day + 6) % 7;
  return rules.some((r) => {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close > open) {
      return ruleCoversDay(r, day) && minute >= open && minute < close;
    }
    return (ruleCoversDay(r, day) && minute >= open) || (ruleCoversDay(r, prevDay) && minute < close);
  });
}

const SAMPLE_STEP_MINUTES = 15;

// Walks `barRule`'s own span (every day it covers, at SAMPLE_STEP_MINUTES
// resolution — hours are only ever entered in whole-minute UI steps, so
// this is more than fine-grained enough to catch any real gap) and
// confirms every sampled instant also falls inside `generalRules`.
function isContained(barRule: HourRule, generalRules: HourRule[]): boolean {
  const open = toMinutes(barRule.open);
  const close = toMinutes(barRule.close);
  for (const day of daysInRange(barRule.fromDay, barRule.toDay)) {
    if (close > open) {
      for (let m = open; m < close; m += SAMPLE_STEP_MINUTES) {
        if (!isCovered(generalRules, day, m)) return false;
      }
    } else {
      // Wraps past midnight: [open, 24:00) on `day`, then [0, close) on
      // the day right after it — same per-day expansion
      // bar_hours_active_now applies server-side.
      for (let m = open; m < 24 * 60; m += SAMPLE_STEP_MINUTES) {
        if (!isCovered(generalRules, day, m)) return false;
      }
      const nextDay = (day + 1) % 7;
      for (let m = 0; m < close; m += SAMPLE_STEP_MINUTES) {
        if (!isCovered(generalRules, nextDay, m)) return false;
      }
    }
  }
  return true;
}

// Returns the first bar-hours rule that isn't fully covered by the
// restaurant's general hours, or null if every rule is contained.
// Unconfigured general hours (empty array) means the restaurant is
// "always active" (bar_is_active's/restaurant_is_active's own fallback) —
// an unbounded window nothing can fall outside of, so nothing to flag.
export function findUncontainedBarRule(barRules: HourRule[], generalRules: HourRule[]): HourRule | null {
  if (generalRules.length === 0) return null;
  return barRules.find((bar) => !isContained(bar, generalRules)) ?? null;
}
