-- notifications.staff_id/user_id have foreign keys but no covering index —
-- harmless while nothing ever queried this table, but useNotifications.ts
-- (web + mobile, 20260919120000) now filters by exactly these columns on
-- every dashboard/ordering-header load plus every Realtime subscription.
-- Flagged by get_advisors right after that code shipped.
create index notifications_staff_id_idx on notifications (staff_id) where staff_id is not null;
create index notifications_user_id_idx on notifications (user_id) where user_id is not null;
