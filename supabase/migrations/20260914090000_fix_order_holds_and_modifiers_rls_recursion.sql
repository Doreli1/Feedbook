-- Feedbook Backend Schema — close a latent RLS-recursion gap on order_holds
-- and order_item_modifiers (Stage 5 real-implementation prep, 2026-09-14).
--
-- 20260908090000_fix_session_participants_rls_recursion.sql fixed every
-- participant-scoped policy that inline-subqueried session_participants
-- from within its own USING clause (infinite recursion, Postgres 42P17) by
-- routing through the SECURITY DEFINER helpers current_participant_ids() /
-- current_participant_session_ids() instead. order_holds and
-- order_item_modifiers were both migrated on 2026-09-12 — after that fix —
-- but were written against the old inline pattern anyway (copy-pasted from
-- an earlier example), so they carry the same live bug. Neither table has
-- ever been queried by a real participant yet (place-order doesn't exist
-- until this Stage 5 pass), so this is caught before it ever misfires.
drop policy "participant_manage_own_order_holds" on order_holds;
create policy "participant_manage_own_order_holds"
  on order_holds for all
  using (participant_id in (select current_participant_ids()))
  with check (participant_id in (select current_participant_ids()));

drop policy "participant_manage_own_order_item_modifiers" on order_item_modifiers;
create policy "participant_manage_own_order_item_modifiers"
  on order_item_modifiers for all
  using (
    order_item_id in (
      select oi.id from order_items oi
      join orders o on o.id = oi.order_id
      where o.participant_id in (select current_participant_ids())
    )
  )
  with check (
    order_item_id in (
      select oi.id from order_items oi
      join orders o on o.id = oi.order_id
      where o.participant_id in (select current_participant_ids())
    )
  );
