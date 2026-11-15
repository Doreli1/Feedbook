-- Real infinite-loop bug found live (2026-11-09): a diner who paid via
-- confirm-card-payment/confirm-cash-payment got immediately re-nagged by the
-- mail icon's "open visit" reminder right after being disconnected —
-- HeaderMailIcon's own hasPendingReminder check (reminder.sessionId !==
-- currentSessionId) goes true the instant clearTableSession() runs, and
-- get_my_open_session() still found their (still technically 'open', the
-- bar never auto-closes on an individual payment — see
-- project_bar_general_account_spans_full_day) session_participants row,
-- since nothing anywhere ever marked a paid participant as "done." Tapping
-- the reminder restored the exact same already-paid session right back into
-- the local store, which on the next disconnect immediately re-triggered
-- the same reminder — a real "connect, get kicked back to the reminder,
-- resume, get kicked out again" loop, not a one-off glitch.
--
-- Two-part fix: confirm-card-payment/confirm-cash-payment now set left_at on
-- the diner's own session_participants row once their payment is recorded
-- (same "I'm done here" signal leave-session already uses for an explicit
-- walkout — left_reason stays null, since none of its existing values mean
-- "paid" and this isn't the place to invent one); this function now excludes
-- anyone already left, exactly like leave-session's own "remaining active
-- participants" check already does (`.is("left_at", null)`) — a plain
-- oversight before now, since this function predates confirm-*-payment
-- entirely and simply never had a "paid" case to exclude.
create or replace function get_my_open_session()
returns table(
  session_id uuid,
  participant_id uuid,
  restaurant_id uuid,
  restaurant_name text,
  table_id uuid,
  table_number text,
  table_type text,
  session_account_number text,
  sub_account_number text,
  bar_ticket_number integer,
  review_verification_code text,
  qr_token text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    ts.id,
    sp.id,
    r.id,
    r.name,
    t.id,
    t.table_number,
    t.table_type,
    ts.session_account_number,
    sp.sub_account_number,
    sp.bar_ticket_number,
    sp.review_verification_code,
    t.qr_code_token
  from session_participants sp
  join table_sessions ts on ts.id = sp.session_id
  join tables t on t.id = ts.table_id
  join restaurants r on r.id = ts.restaurant_id
  where sp.user_id = auth.uid()
    and sp.left_at is null
    and ts.status = 'open'
  order by sp.joined_at desc
  limit 1;
$function$;
