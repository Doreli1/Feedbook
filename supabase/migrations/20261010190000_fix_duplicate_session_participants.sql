-- Fix: session_participants allowed duplicate rows for the same
-- (session_id, user_id) pair under concurrent join-session calls (e.g. a
-- double-tap on add-participants.tsx's "המשך" button — no disabled state
-- existed there before this fix). join-session's idempotency check
-- (select-then-insert) is not atomic, so two near-simultaneous calls could
-- both pass the "does this participant already exist" check and both
-- insert. Found via a real account-screen bug report: a single diner's
-- personal-account total was lower than the general-account total, because
-- their own orders ended up split across multiple participant rows for the
-- same session.

-- Step 1: merge existing duplicates (dev/test data) onto the earliest row
-- per (session_id, user_id), before the constraint below can be added.
do $$
declare
  dup record;
  canonical uuid;
begin
  for dup in
    select session_id, user_id
    from session_participants
    where user_id is not null
    group by session_id, user_id
    having count(*) > 1
  loop
    select id into canonical
    from session_participants
    where session_id = dup.session_id and user_id = dup.user_id
    order by joined_at asc
    limit 1;

    update orders set participant_id = canonical
      where participant_id in (
        select id from session_participants
        where session_id = dup.session_id and user_id = dup.user_id and id <> canonical
      );
    update order_holds set participant_id = canonical
      where participant_id in (
        select id from session_participants
        where session_id = dup.session_id and user_id = dup.user_id and id <> canonical
      );
    update payment_participant_shares set participant_id = canonical
      where participant_id in (
        select id from session_participants
        where session_id = dup.session_id and user_id = dup.user_id and id <> canonical
      );
    update dish_views set participant_id = canonical
      where participant_id in (
        select id from session_participants
        where session_id = dup.session_id and user_id = dup.user_id and id <> canonical
      );

    delete from session_participants
      where session_id = dup.session_id and user_id = dup.user_id and id <> canonical;
  end loop;
end $$;

-- Step 2: close the race at the database level.
alter table session_participants
  add constraint session_participants_session_id_user_id_key unique (session_id, user_id);
