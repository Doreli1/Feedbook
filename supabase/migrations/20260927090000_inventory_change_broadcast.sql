-- Replace postgres_changes on RLS-protected tables with a broadcast ping
-- (2026-09-27). Root cause confirmed via a live test: Realtime filters
-- postgres_changes delivery through the SUBSCRIBER's own RLS on the
-- changed table. `ingredients`, `dish_ingredients` and
-- `modifier_option_ingredients` are all staff-only (no public/diner SELECT
-- policy at all, by design — exact stock levels, SKUs and supplier info are
-- private operational data) — so a diner's client subscribing to
-- postgres_changes on any of them can NEVER receive an event, no matter how
-- healthy the replication connection is. This isn't a transient bug; it's
-- structural. (A comparison test confirmed `dishes`, which IS publicly
-- readable, delivers postgres_changes events to the same anon subscriber
-- instantly.)
--
-- This affects three mobile hooks — useDishCriticalStock,
-- useDishMissingIngredients, useUnavailableModifierOptions — all of which
-- fetch correctly on load (via their own security-definer RPCs) but never
-- update live, matching the QA report's findings (tests 3, 10, 11).
--
-- Fix: Supabase's "Broadcast from Database" pattern. A trigger sends an
-- empty ping (no row data — these tables carry exactly the private
-- operational data this system has been careful never to expose to
-- diners elsewhere) to a per-restaurant topic; the client listens via
-- `on('broadcast', ...)` instead of `on('postgres_changes', ...)`, which
-- is a plain message delivery, not a row-level replication event, and so
-- is completely unaffected by the source tables' RLS.

-- Broadcast receive policy: any authenticated user (no anonymous diners
-- exist in this system) may receive messages on any topic. Safe because the
-- payload is always empty ({}) — it only ever means "something changed for
-- this restaurant, go refetch the safe aggregate" — never any of the
-- private data itself. The topic name embeds a restaurant_id, but knowing
-- "restaurant X's inventory changed" carries no more information than
-- restaurant IDs already do elsewhere (e.g. public menu/photo URLs).
create policy "authenticated_receive_broadcasts"
on realtime.messages
for select
to authenticated
using (true);

-- Topic format: 'restaurant_inventory:<uuid>' — colon separator (not '-')
-- specifically because a UUID already contains hyphens, which would make
-- split_part(topic, '-', n)-style parsing ambiguous if ever needed later.
create or replace function notify_restaurant_inventory_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  if TG_TABLE_NAME = 'ingredients' then
    v_restaurant_id := coalesce(new.restaurant_id, old.restaurant_id);
  elsif TG_TABLE_NAME = 'dish_ingredients' then
    select d.restaurant_id into v_restaurant_id from dishes d where d.id = coalesce(new.dish_id, old.dish_id);
  elsif TG_TABLE_NAME = 'modifier_option_ingredients' then
    select d.restaurant_id into v_restaurant_id
    from dish_modifier_options o
    join dish_modifier_groups g on g.id = o.group_id
    join dishes d on d.id = g.dish_id
    where o.id = coalesce(new.modifier_option_id, old.modifier_option_id);
  end if;

  if v_restaurant_id is not null then
    perform realtime.send('{}'::jsonb, 'changed', 'restaurant_inventory:' || v_restaurant_id::text, true);
  end if;
  return null;
end;
$$;

create trigger notify_inventory_change
  after insert or update or delete on ingredients
  for each row execute function notify_restaurant_inventory_change();

create trigger notify_inventory_change
  after insert or update or delete on dish_ingredients
  for each row execute function notify_restaurant_inventory_change();

create trigger notify_inventory_change
  after insert or update or delete on modifier_option_ingredients
  for each row execute function notify_restaurant_inventory_change();
