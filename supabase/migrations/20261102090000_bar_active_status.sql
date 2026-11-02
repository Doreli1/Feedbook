-- Bar active/inactive status (2026-11-02, user decision: hybrid — a default
-- weekly schedule with a manual staff override on top). Documented in
-- Backend Schema vr13 §1.4 / API Specification v11-v12 / Implementation Plan
-- v23-v24 before this migration was written.
--
-- restaurants.bar_hours: same {rules:[{fromDay,toDay,open,close}]} jsonb
-- shape as restaurants.hours (RestaurantDetailsForm.tsx's DAY_KEYS/HourRule/
-- parseHours), but governs the BAR specifically, independent of the
-- restaurant's own general hours — a restaurant can be open with its bar
-- closed, or (the dance-bar case that motivated this) have a bar that only
-- runs part of the day.
--
-- restaurants.bar_manual_override: 'open' | 'closed' | null. null (the
-- default) means "follow bar_hours". A non-null value wins over bar_hours
-- unconditionally — the staff-facing quick toggle (BarOrdersScreen) and the
-- owner-facing schedule editor (RestaurantDetailsForm) both write this same
-- column, so either side always sees the other's latest change.
alter table restaurants
  add column bar_hours jsonb,
  add column bar_manual_override text;

alter table restaurants
  add constraint restaurants_bar_manual_override_check
  check (bar_manual_override is null or bar_manual_override in ('open', 'closed'));

-- Pure time-of-day evaluator, parallel to restaurant_hours_excludes_saturday/
-- restaurant_hours_strip_saturday (20260910130000) but checking open/close
-- clock times, not just day coverage — those two only ever needed to know
-- which DAY a rule covers. Handles a rule crossing midnight (close <= open,
-- e.g. 22:00-02:00 for the "becomes a dance bar at night" case this feature
-- was built for) by also checking each rule anchored on "yesterday", so the
-- early-morning hours of the following calendar day are still covered.
-- Hardcoded to Asia/Jerusalem — this project has no restaurant timezone
-- field anywhere yet (same assumption the kosher-Saturday trigger makes).
create or replace function bar_hours_active_now(p_bar_hours jsonb, p_now timestamptz default now())
returns boolean
language sql
stable
as $$
  with local_today as (
    select (p_now at time zone 'Asia/Jerusalem')::date as d
  ),
  anchors as (
    select d - days_back as anchor_date, extract(dow from d - days_back)::int as anchor_dow
    from local_today, generate_series(0, 1) as days_back
  ),
  rules as (
    select
      (rule->>'fromDay')::int as from_day,
      (rule->>'toDay')::int as to_day,
      (rule->>'open')::time as open_t,
      (rule->>'close')::time as close_t
    from jsonb_array_elements(
      case when jsonb_typeof(p_bar_hours -> 'rules') = 'array' then p_bar_hours -> 'rules' else '[]'::jsonb end
    ) as rule
  )
  select exists (
    select 1
    from anchors a
    join rules r on (
      case
        when r.from_day <= r.to_day then a.anchor_dow between r.from_day and r.to_day
        else a.anchor_dow >= r.from_day or a.anchor_dow <= r.to_day
      end
    )
    cross join lateral (
      select
        (a.anchor_date + r.open_t) at time zone 'Asia/Jerusalem' as open_ts,
        case
          when r.close_t <= r.open_t then (a.anchor_date + 1 + r.close_t) at time zone 'Asia/Jerusalem'
          else (a.anchor_date + r.close_t) at time zone 'Asia/Jerusalem'
        end as close_ts
    ) bounds
    where p_now >= bounds.open_ts and p_now < bounds.close_ts
  );
$$;

-- The single shared "is the bar open right now" answer — called from both
-- scan-qr (gating new bar sessions) and the Web Admin status indicator, so
-- the two can never disagree. Override wins when set; an unconfigured
-- schedule (bar_hours null/empty — a restaurant that never opted into this
-- feature) defaults to ACTIVE, matching how restaurants.hours itself has
-- never been enforced as a session gate either — adding this feature must
-- not retroactively lock out a bar that already worked fine with no
-- schedule configured.
create or replace function bar_is_active(p_restaurant_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when r.bar_manual_override = 'open' then true
    when r.bar_manual_override = 'closed' then false
    when r.bar_hours is null or jsonb_typeof(r.bar_hours -> 'rules') is distinct from 'array' or jsonb_array_length(r.bar_hours -> 'rules') = 0 then true
    else bar_hours_active_now(r.bar_hours)
  end
  from restaurants r
  where r.id = p_restaurant_id;
$$;

grant execute on function bar_is_active(uuid) to authenticated;

-- Lazy auto-close (no cron infrastructure exists in this project): whenever
-- the bar's active status is actually checked — a scan-qr attempt, or
-- BarOrdersScreen loading — and it turns out to be inactive, any lingering
-- open table_sessions row for the bar table is closed right then. This is
-- what makes "חשבון כללי של הבר מצייג את כל יום הפעילות של הבר משעת
-- הפתיחה ועד שעת הסגירה" (the user's own framing, 2026-11-02) actually
-- true — without this, the bar's open session would otherwise just sit
-- open indefinitely across an inactive window, the same open-ended
-- behavior table_sessions always had for the bar before this feature
-- existed.
create or replace function bar_close_if_inactive(p_restaurant_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_active boolean;
begin
  v_active := bar_is_active(p_restaurant_id);
  if not v_active then
    update table_sessions ts
    set status = 'closed', closed_at = now()
    from tables t
    where ts.table_id = t.id
      and t.restaurant_id = p_restaurant_id
      and t.table_type = 'bar'
      and ts.status = 'open';
  end if;
  return v_active;
end;
$$;

grant execute on function bar_close_if_inactive(uuid) to authenticated;
