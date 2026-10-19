-- Self-service "end visit" for a diner who placed no order (2026-10-19,
-- user request) — session_participants.left_at already existed in the
-- schema from day one (20260830145832_tenant_and_identity.sql) but was
-- never read or written anywhere. Adding the reason columns alongside it
-- for the same event, set together by the new leave-session Edge Function.
alter table session_participants
  add column left_reason text,
  add column left_reason_other text;

alter table session_participants
  add constraint session_participants_left_reason_check
  check (
    left_reason is null
    or left_reason in ('menu_not_suitable', 'prices_not_suitable', 'joined_by_mistake', 'just_browsing', 'changed_mind', 'other')
  );
