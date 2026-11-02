-- Real gap found 2026-11-02, right after shipping bar_close_if_inactive
-- (20261102090000_bar_active_status.sql): it force-closed the bar's open
-- table_sessions row the moment the bar went inactive, with no regard for
-- whether every diner's payment share was actually settled yet — unlike
-- close-session (the normal, manual close path), which explicitly refuses
-- to close while any payment_participant_shares row on the session is
-- still 'pending' (UNPAID_SHARES_EXIST, see close-session/index.ts).
-- Silently force-closing an unpaid bar account on a schedule would make
-- outstanding debt disappear from view and block the normal payment flow —
-- the bar's active/inactive status is a scheduling concept, not a
-- statement about who still owes money.
--
-- Fix: only close the session when there is nothing left unpaid on it —
-- the identical check close-session itself runs. When diners are still
-- settling up past closing time, the session is left open (bar_is_active
-- still correctly reports false — scan-qr still blocks new arrivals — but
-- the existing account stays open and visible until staff actually collect
-- payment, exactly like a regular table that isn't cleared until it's paid).
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
      and ts.status = 'open'
      and not exists (
        select 1
        from payment_participant_shares pps
        join payments p on p.id = pps.payment_id
        where p.session_id = ts.id
          and pps.status = 'pending'
      );
  end if;
  return v_active;
end;
$$;
