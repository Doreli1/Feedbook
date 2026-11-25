-- Real feature (2026-11-21, explicit user request): the original "kosher-
-- certified restaurants must be closed all of Saturday" rule
-- (20260910130000_kosher_saturday_closed_enforcement.sql) was too blunt —
-- some certified restaurants open on מוצאי שבת (after Shabbat ends
-- Saturday evening). There is no sunset/havdalah calculation anywhere in
-- this project (varies by week/season/location), so per explicit user
-- decision this is a per-restaurant custom field, not a computed one: each
-- certified restaurant sets its own `kosher_saturday_earliest_open` once,
-- and any Saturday-touching hours rule is only compliant if its `open`
-- time is at or after that restaurant's own configured floor. Unset
-- (null) keeps today's original behavior — Saturday fully excluded, same
-- as before this migration — so an already-certified restaurant that never
-- touches this new field sees no change at all.
--
-- New functions, NOT a replacement of the original 1-arg
-- restaurant_hours_excludes_saturday(jsonb)/restaurant_hours_strip_saturday
-- (jsonb) — Postgres overloads by argument list, so adding a (jsonb, time)
-- pair alongside them is additive; the two old 1-arg functions are left in
-- place, now simply unused, rather than dropped (a `drop function`
-- migration is reliably blocked by the Claude Code auto mode classifier in
-- this project — confirmed repeatedly this session — and they're harmless
-- dead code either way).
alter table restaurants
  add column kosher_saturday_earliest_open time;

-- A rule's open/close/day-range is uniform across every day it covers (one
-- shared open time per rule, not one per day) — so a rule that reaches into
-- Saturday is compliant as a WHOLE the moment its open time clears the
-- restaurant's own floor, multi-day shape included (e.g. "Thu-Sat
-- 21:00-23:30" opens every one of those days at 21:00, Saturday included —
-- perfectly fine if 21:00 is at/after the configured floor). No null floor
-- means no Saturday coverage at all is ever compliant, matching the
-- original rule exactly for a certified restaurant that never sets this.
create or replace function restaurant_hours_saturday_compliant(p_hours jsonb, p_earliest_open time)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(p_hours -> 'rules') = 'array' then p_hours -> 'rules' else '[]'::jsonb end
    ) as rule
    where
      (
        ((rule->>'fromDay')::int <= (rule->>'toDay')::int and 6 between (rule->>'fromDay')::int and (rule->>'toDay')::int)
        or ((rule->>'fromDay')::int > (rule->>'toDay')::int and (6 >= (rule->>'fromDay')::int or 6 <= (rule->>'toDay')::int))
      )
      and (p_earliest_open is null or (rule->>'open')::time < p_earliest_open)
  );
$$;

-- Same truncate/drop fallback as the original restaurant_hours_strip_saturday
-- for any rule that still fails compliance (no floor configured, or this
-- particular rule's open time is earlier than the floor) — a non-wrapping
-- range that merely reaches into Saturday gets shortened to end Friday,
-- anything else touching Saturday gets dropped entirely. A rule that DOES
-- clear the floor is kept completely untouched.
create or replace function restaurant_hours_strip_saturday(p_hours jsonb, p_earliest_open time)
returns jsonb
language sql
immutable
set search_path = public
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
              when p_earliest_open is not null and (elem->>'open')::time >= p_earliest_open
                then elem
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

-- One-time data fix, same reasoning as the original migration's own: correct
-- any existing certified restaurant's stored hours before the CHECK
-- constraint below is re-added (validated against all existing rows at
-- creation time). Every current certified restaurant has kosher_saturday_
-- earliest_open still null at this point (the column was just added), so
-- this is a no-op pass-through of the exact same strip behavior as before.
update restaurants
set hours = restaurant_hours_strip_saturday(hours, kosher_saturday_earliest_open)
where kosher_status = 'certified'
  and not restaurant_hours_saturday_compliant(hours, kosher_saturday_earliest_open);

-- Replaces the original kosher_certified_excludes_saturday constraint (which
-- only ever took `hours`) with the floor-aware version. A plain
-- ALTER CONSTRAINT can't change a CHECK expression — has to be dropped and
-- re-added.
alter table restaurants
  drop constraint if exists kosher_certified_excludes_saturday;

alter table restaurants
  add constraint kosher_certified_saturday_hours_compliant
  check (kosher_status <> 'certified' or restaurant_hours_saturday_compliant(hours, kosher_saturday_earliest_open));

-- Self-healing trigger, same shape as before — now floor-aware. Still
-- silently strips instead of rejecting, so upload-kashrut-certificate's own
-- update({kosher_status: 'certified', ...}) call keeps working unchanged.
create or replace function enforce_kosher_saturday_closed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kosher_status = 'certified' and not restaurant_hours_saturday_compliant(new.hours, new.kosher_saturday_earliest_open) then
    new.hours := restaurant_hours_strip_saturday(new.hours, new.kosher_saturday_earliest_open);
  end if;
  return new;
end;
$$;
