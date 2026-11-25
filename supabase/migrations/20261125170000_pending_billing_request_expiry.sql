-- Real feature (2026-11-25, explicit user request): a sent "add friend to my
-- account" request used to stay pending forever until the friend actually
-- responded (or the sender explicitly cancelled it — see bill-summary.tsx's
-- own handleCancelPendingRequests) — no automatic expiry at all. Adds a
-- 1-minute validity window: pending_billing_request_at records when the
-- request was actually sent (alongside pending_billing_request_from, which
-- already existed), and expire_stale_billing_requests() clears both fields
-- once more than a minute has passed, reverting everyone to paying for
-- themselves independently — exactly what a manual cancel already does.
--
-- No cron exists in this project (checked repo-wide, same constraint noted
-- in close_zero_balance_table_sessions's own comment) — this is called
-- opportunistically instead: from the top of link-personal-account-members
-- and respond-to-personal-account-link (so stale state never leaks into
-- either function's own checks), and on a short client-side poll from
-- GlobalBillingLinkListener (mounted once, globally, for the whole app
-- session) so a request expires visibly on both sides without either of
-- them needing to take any action — see that component's own comment for
-- why "up to roughly a minute" (poll granularity), not an exact deadline,
-- is an accepted, deliberate tradeoff here.
alter table session_participants
  add column pending_billing_request_at timestamptz;

create or replace function expire_stale_billing_requests()
returns void
language sql
security definer
set search_path = public
as $$
  update session_participants
  set pending_billing_request_from = null, pending_billing_request_at = null
  where pending_billing_request_from is not null
    and pending_billing_request_at is not null
    and pending_billing_request_at < now() - interval '1 minute';
$$;

grant execute on function expire_stale_billing_requests() to authenticated;
