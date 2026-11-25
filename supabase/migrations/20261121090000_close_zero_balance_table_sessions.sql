-- Real feature (2026-11-21, explicit user request, after walking through
-- the useAccounts.ts "שולם" mislabel found live): a REGULAR table whose
-- diner(s) never ordered anything (or had everything cancelled) stayed
-- `table_sessions.status = 'open'` forever once the restaurant's own
-- operating hours ended for the day — nobody ever closes an empty table,
-- so it just sat there, forgotten, until the next scan reused/confused it.
-- This mirrors bar_close_if_inactive's own EOD sweep, but for ordinary
-- tables (never the bar — its shared general account is governed purely by
-- its own schedule, see project_bar_general_account_spans_full_day memory,
-- and never by individual diners/balances).
--
-- Deliberately treats this as a REAL departure, not just an administrative
-- status flip (explicit user decision, three-question walkthrough):
--   1. table_sessions -> 'closed' (same side effect confirm-card-payment's
--      own fully-settled-group branch already produces for a real payment).
--   2. EVERY session_participants row on it gets left_at = now() if not
--      already set — the SAME signal the personal-account consent flow
--      (20261117100000_personal_account_link_consent.sql) and the mobile
--      app's own GlobalBillingLinkListener already watch live. A diner
--      still physically seated when this fires WILL see their own phone
--      show "חשבונכם שולם ונסגר" and get routed back to their profile,
--      exactly as if a friend had just paid for them — accepted
--      consciously: the user chose this over leaving left_at untouched,
--      specifically so a truly-forgotten table doesn't keep a phantom
--      "active" diner around either.
--   3. tables -> 'awaiting_cleaning', same as confirm-card-payment's own
--      fully-settled close, so the physical table re-enters the normal
--      cleaning/available cycle instead of staying falsely "occupied".
--
-- "Zero balance" is computed the same way confirm-card-payment's own
-- computeParticipantSubtotal does (sum of non-cancelled order_items'
-- unit_price + modifier total, times quantity) — just aggregated across
-- every participant on the session instead of one at a time, since the
-- whole account either has nothing left to collect or it doesn't.
--
-- No cron exists in this project (checked repo-wide) — called opportunis-
-- tically from useAccounts.ts's own refresh(), the exact same "piggyback on
-- whichever staff screen happens to be open" pattern bar_close_if_inactive
-- already uses (explicit user choice: good enough for now, a real
-- scheduled job is future work, not required to ship this).
create or replace function close_zero_balance_table_sessions(p_restaurant_id uuid)
returns void
language plpgsql
as $$
declare
  v_session record;
  v_total numeric;
begin
  if restaurant_is_active(p_restaurant_id) then
    return;
  end if;

  for v_session in
    select ts.id as session_id, ts.table_id
    from table_sessions ts
    join tables t on t.id = ts.table_id
    where t.restaurant_id = p_restaurant_id
      and t.table_type is distinct from 'bar'
      and t.archived_at is null
      and ts.status = 'open'
  loop
    select coalesce(sum((oi.unit_price + coalesce(m.modifier_total, 0)) * oi.quantity), 0)
      into v_total
      from session_participants sp
      join orders o on o.participant_id = sp.id
      join order_items oi on oi.order_id = o.id
      left join lateral (
        select sum(oim.price_delta_at_order) as modifier_total
        from order_item_modifiers oim
        where oim.order_item_id = oi.id
      ) m on true
      where sp.session_id = v_session.session_id
        and oi.status <> 'cancelled';

    if v_total = 0 then
      update table_sessions set status = 'closed', closed_at = now() where id = v_session.session_id;
      update session_participants set left_at = now() where session_id = v_session.session_id and left_at is null;
      update tables set status = 'awaiting_cleaning' where id = v_session.table_id;
    end if;
  end loop;
end;
$$;

grant execute on function close_zero_balance_table_sessions(uuid) to authenticated;
