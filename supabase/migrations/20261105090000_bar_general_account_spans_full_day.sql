-- Real architectural correction, 2026-11-05 (explicit user request, after
-- walking through the 889143 case): the bar's single daily general account
-- must be governed PURELY by the bar's/restaurant's defined operating
-- HOURS — not by whether anyone has connected to it, and not by a staff
-- manual override toggled mid-shift. Two concrete fixes:
--
-- 1. A manual bar_manual_override = 'closed' (BarOrdersScreen's quick
--    toggle) must only block NEW orders/scans (bar_is_active, unchanged,
--    still used by scan-qr/place-order for exactly that gate) — it must
--    NOT actually close today's general account's table_sessions row
--    anymore. This is what silently happened to account #889143: toggling
--    the override off for a moment (during earlier testing) and back on
--    permanently ended that day's account only 17 minutes after it opened,
--    even though the bar's actual schedule still had hours left. The
--    account's own open/closed lifecycle now follows the SCHEDULE only
--    (bar_schedule_active, new below) — the same fallback order
--    bar_is_active already uses (bar_hours, then the restaurant's own
--    hours, then "always active" if neither is configured), just without
--    the manual-override branches.
--
-- 2. The account must exist proactively from the moment the scheduled
--    window begins, not only lazily on a diner's first scan — "המערכת
--    מרגע הפעלה של הבר... אמורה להקצות גם מספר חשבון כללי לכל משך הפעילות
--    של הבר עבור אותו היום... כל יום בבר מציג חשבון כללי אחד בלבד" (the
--    user's own framing). There's no cron in this project to do that on a
--    schedule, so bar_close_if_inactive — already polled every 15s from
--    both staff screens (BarOrdersScreen/TableStatusBoard, via
--    useBarStatus.ts) and checked on every scan-qr attempt — is extended to
--    also ensure one exists whenever the schedule says active and none is
--    currently open, instead of adding a new call site. Despite the name,
--    it now reconciles BOTH directions (closes when the window ends, opens
--    when it begins) — kept as one function so every existing caller (TS
--    code in scan-qr, useBarStatus.ts, useOrderingAvailability.ts) gets the
--    new behavior with zero changes on their end.

-- Account-lifecycle signal (2026-11-05, corrected same day after a real
-- self-contradiction was found): bar_is_active() MINUS only the
-- override = 'closed' branch — NOT schedule alone. An earlier version of
-- this function ignored manual override entirely, which created a genuine
-- bug: if staff set bar_manual_override = 'open' BEFORE the scheduled
-- window starts (accidentally or deliberately, e.g. opening early), a
-- diner could scan in — bar_is_active() correctly allows it, override wins
-- — and scan-qr would create today's account... which the very NEXT poll
-- (15s later, from any open staff screen) would immediately close again,
-- because this function didn't know about the override and only saw
-- "before scheduled hours." Reproduced directly: created a session while
-- override='open' and schedule said inactive, then called
-- bar_close_if_inactive once more — it closed the session that had just
-- been allowed to open. override = 'open' must keep the account open (or
-- let it be created) exactly as much as it lets new diners scan in — the
-- two can never disagree, or the override tears down the very thing it
-- just authorized. override = 'closed' is still the one branch dropped —
-- see this migration's own header comment point 1 for why.
create or replace function bar_schedule_active(p_restaurant_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when not restaurant_is_active(p_restaurant_id) then false
    when r.bar_manual_override = 'open' then true
    when r.bar_hours is not null
      and jsonb_typeof(r.bar_hours -> 'rules') = 'array'
      and jsonb_array_length(r.bar_hours -> 'rules') > 0
      then bar_hours_active_now(r.bar_hours)
    when r.hours is not null
      and jsonb_typeof(r.hours -> 'rules') = 'array'
      and jsonb_array_length(r.hours -> 'rules') > 0
      then bar_hours_active_now(r.hours)
    else true
  end
  from restaurants r
  where r.id = p_restaurant_id;
$$;

grant execute on function bar_schedule_active(uuid) to authenticated;

-- At most one OPEN session per BAR table, enforced at the DB level
-- (2026-11-05) — closes a theoretical race between two near-simultaneous
-- callers (a diner's scan-qr and staff's useBarStatus poll, say) both
-- proactively creating a session for the same bar table at once: the
-- second insert now fails (errcode unique_violation, so
-- bar_close_if_inactive's own insert below already catches it the same way
-- it catches a genuine session_account_number collision) instead of
-- silently creating a second same-day general account.
--
-- A trigger, not a plain unique index on (table_id) where status='open' —
-- checked directly: regular (non-bar) tables already have real pre-existing
-- rows violating that globally (old test/seed sessions from 2026-09, e.g.
-- table T1 has two simultaneously "open" sessions, one literally named
-- 'TEST-ACCT-1') — a blanket index would fail to create today, and cleaning
-- up unrelated old dine-in-table data is out of scope here; it's the same
-- forgotten-session gap already tracked separately (see memory
-- project_forgotten_session_table_release_gap). Scoping the check to
-- table_type = 'bar' via a trigger sidesteps that pre-existing mess
-- entirely while still giving the bar the real guarantee it needs.
--
-- pg_advisory_xact_lock, not just the exists-check alone (2026-11-05,
-- real bug found live the same day): reproduced for real — the bar's
-- schedule crossed into its active window and TWO near-simultaneous
-- callers (two open staff screens both polling via useBarStatus.ts, most
-- likely) each ran the exists-check before either had committed its own
-- INSERT. Under READ COMMITTED, an uncommitted row from another
-- transaction is simply invisible — both checks saw "no open session" and
-- both inserts succeeded, producing two general accounts for the same bar
-- table 8ms apart. The lock (keyed by table_id, auto-released at
-- transaction end) forces the second caller to block until the first
-- actually commits, so its own exists-check then correctly sees that row.
create or replace function enforce_single_open_bar_session()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.table_id::text)::bigint);

  if exists (
    select 1
    from table_sessions ts
    join tables t on t.id = ts.table_id
    where ts.table_id = new.table_id
      and ts.status = 'open'
      and ts.id <> new.id
      and t.table_type = 'bar'
  ) then
    raise exception 'A bar table already has an open session (table_id=%)', new.table_id
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_single_open_bar_session on table_sessions;
create trigger trg_single_open_bar_session
  before insert or update of status on table_sessions
  for each row
  when (new.status = 'open')
  execute function enforce_single_open_bar_session();

create or replace function bar_close_if_inactive(p_restaurant_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_active boolean;
  v_schedule_active boolean;
  v_table record;
begin
  v_active := bar_is_active(p_restaurant_id);
  v_schedule_active := bar_schedule_active(p_restaurant_id);

  if not v_schedule_active then
    update table_sessions ts
    set status = 'closed', closed_at = now()
    from tables t
    where ts.table_id = t.id
      and t.restaurant_id = p_restaurant_id
      and t.table_type = 'bar'
      and ts.status = 'open'
      and not exists (
        select 1
        from payment_participant_shares pps
        join payments p on p.id = pps.payment_id
        where p.session_id = ts.id
          and pps.status = 'pending'
      );
  else
    -- Proactively ensure today's single general account exists for every
    -- bar table that doesn't already have one open — see this migration's
    -- own header comment for why (point 2).
    for v_table in
      select t.id
      from tables t
      where t.restaurant_id = p_restaurant_id
        and t.table_type = 'bar'
        and t.archived_at is null
        and not exists (select 1 from table_sessions ts2 where ts2.table_id = t.id and ts2.status = 'open')
    loop
      begin
        insert into table_sessions (restaurant_id, table_id, session_account_number)
        values (p_restaurant_id, v_table.id, (trunc(random() * 900000 + 100000))::bigint::text);
      exception when unique_violation then
        -- Another concurrent caller already created one (either the same
        -- session_account_number by sheer 6-digit coincidence, or — far
        -- more likely — the new one-open-session-per-table index above).
        -- Nothing to do; it already exists.
        null;
      end;
    end loop;
  end if;

  return v_active;
end;
$$;
