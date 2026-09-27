-- Kosher-certified restaurants must be closed on Saturday (day 6, Date.getDay()
-- convention) — promotes the display-only rule from restaurant-details.tsx
-- (getTodayHourLines/getWeekHourLines) into a real, self-healing DB guarantee.
--
-- Design: a BEFORE trigger auto-strips any Saturday coverage from `hours`
-- whenever a row is written with kosher_status = 'certified' (so the existing
-- upload-kashrut-certificate flow, which only ever touches kosher_status, keeps
-- working unchanged even if the restaurant already had Saturday hours), backed
-- by a CHECK constraint as the hard backstop that makes the rule an actual DB
-- guarantee rather than just app-layer convention.

-- Pure predicate: does this hours jsonb contain any rule covering Saturday?
-- Mirrors the wrap-aware "covers day" logic already used client-side in
-- apps/mobile/app/restaurant-details.tsx (ruleCoversDay). Null/missing/
-- non-array rules are trivially compliant.
create or replace function restaurant_hours_excludes_saturday(p_hours jsonb)
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(p_hours -> 'rules') = 'array' then p_hours -> 'rules' else '[]'::jsonb end
    ) as rule
    where (
      (rule->>'fromDay')::int <= (rule->>'toDay')::int
      and 6 between (rule->>'fromDay')::int and (rule->>'toDay')::int
    )
    or (
      (rule->>'fromDay')::int > (rule->>'toDay')::int
      and (6 >= (rule->>'fromDay')::int or 6 <= (rule->>'toDay')::int)
    )
  );
$$;

-- Pure transformer: returns a copy of hours with any Saturday coverage
-- removed. Non-wrapping rule covering Saturday that starts before it ->
-- truncated to end Friday (toDay=5), same truncation the mobile display
-- layer already performs in getWeekHourLines. Saturday-only rules, or the
-- (unused-in-practice) wrapping rules that touch Saturday, are dropped
-- entirely as a safe fallback.
create or replace function restaurant_hours_strip_saturday(p_hours jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    coalesce(p_hours, '{}'::jsonb),
    '{rules}',
    coalesce(
      (
        select jsonb_agg(fixed)
        from (
          select
            case
              when not (
                ((elem->>'fromDay')::int <= (elem->>'toDay')::int and 6 between (elem->>'fromDay')::int and (elem->>'toDay')::int)
                or ((elem->>'fromDay')::int > (elem->>'toDay')::int and (6 >= (elem->>'fromDay')::int or 6 <= (elem->>'toDay')::int))
              ) then elem
              when (elem->>'fromDay')::int <= (elem->>'toDay')::int and (elem->>'fromDay')::int < 6
                then jsonb_build_object('fromDay', (elem->>'fromDay')::int, 'toDay', 5, 'open', elem->>'open', 'close', elem->>'close')
              else null
            end as fixed
          from jsonb_array_elements(
            case when jsonb_typeof(p_hours -> 'rules') = 'array' then p_hours -> 'rules' else '[]'::jsonb end
          ) as elem
        ) t
        where fixed is not null
      ),
      '[]'::jsonb
    )
  );
$$;

-- One-time data fix: correct any existing certified restaurant whose stored
-- hours already cover Saturday, before the CHECK constraint below is added
-- (a CHECK is validated against all existing rows at creation time).
update restaurants
set hours = restaurant_hours_strip_saturday(hours)
where kosher_status = 'certified'
  and not restaurant_hours_excludes_saturday(hours);

-- Hard backstop: a certified restaurant's hours must never cover Saturday.
-- In normal operation the trigger below prevents this from ever firing —
-- this constraint exists so the rule holds even if the trigger is ever
-- bypassed or removed.
alter table restaurants
  add constraint kosher_certified_excludes_saturday
  check (kosher_status <> 'certified' or restaurant_hours_excludes_saturday(hours));

-- Self-healing trigger: whenever a row is written with kosher_status =
-- 'certified', silently strip any Saturday coverage from hours instead of
-- rejecting the write. This is what keeps upload-kashrut-certificate's
-- existing update({kosher_status: 'certified', ...}) call working unchanged
-- even when the restaurant already had Saturday hours saved from before
-- certification.
create or replace function enforce_kosher_saturday_closed()
returns trigger
language plpgsql
as $$
begin
  if new.kosher_status = 'certified' and not restaurant_hours_excludes_saturday(new.hours) then
    new.hours := restaurant_hours_strip_saturday(new.hours);
  end if;
  return new;
end;
$$;

create trigger trg_enforce_kosher_saturday_closed
  before insert or update on restaurants
  for each row
  execute function enforce_kosher_saturday_closed();
