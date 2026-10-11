-- Enable real editing of an already-placed order item from OrderTracker
-- (2026-10-11, user request) — "בצעו שינויים במנה" was previously a locked,
-- non-interactive placeholder (see OrderTracker.tsx's own former comment):
-- only cancellation worked. The editing UX itself reuses the exact same
-- dish-customization screen (DishDetailModal) already used for adding a
-- dish and for editing an unsent cart line — size/modifiers/quantity, same
-- rules, same UI. Only the save action differs: this PATCHes the existing
-- order_item in place via update-order-item, instead of inserting a new
-- cart line.
--
-- edited_at flags that a diner changed this item after it had already
-- entered the kitchen's prep queue (an editable item is always
-- status='in_progress', i.e. already visible to the kitchen) — surfaced in
-- Web Admin's "הזמנות ומטבח" so staff notice a requirement changed instead
-- of silently preparing the pre-edit version.
alter table order_items
  add column edited_at timestamptz;

-- update_order_item_transaction previously only touched size/modifiers
-- (bare modifier_option_id list, predating modifier_option_serving_variants
-- — see 20260929150000) and never quantity. Dropped and recreated with a
-- new signature mirroring place_order_transaction's own modifier-resolution
-- shape exactly (modifier_selections: {modifier_option_id,
-- serving_variant_id}[], a chosen variant's price_delta overriding the
-- option's own, never adding to it), plus p_quantity so a diner can change
-- how many of the dish they ordered through the same edit screen.
drop function if exists update_order_item_transaction(uuid, uuid, jsonb);

create function update_order_item_transaction(
  p_order_item_id uuid,
  p_quantity int,
  p_dish_size_option_id uuid,
  p_modifier_selections jsonb
)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_dish_id uuid;
  v_unit_price numeric(10, 2);
  v_selection jsonb;
  v_modifier_id uuid;
  v_variant_id uuid;
  v_modifier_price numeric(10, 2);
begin
  select dish_id into v_dish_id from order_items where id = p_order_item_id;
  if v_dish_id is null then
    raise exception 'DISH_NOT_AVAILABLE';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'DISH_NOT_AVAILABLE';
  end if;

  if p_dish_size_option_id is not null then
    select price into v_unit_price
      from dish_size_options
      where id = p_dish_size_option_id and dish_id = v_dish_id;
    if v_unit_price is null then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;
  else
    select price into v_unit_price from dishes where id = v_dish_id;
  end if;

  update order_items
    set dish_size_option_id = p_dish_size_option_id,
        quantity = p_quantity,
        unit_price = v_unit_price,
        edited_at = now()
    where id = p_order_item_id;

  delete from order_item_modifiers where order_item_id = p_order_item_id;

  for v_selection in select * from jsonb_array_elements(coalesce(p_modifier_selections, '[]'::jsonb))
  loop
    v_modifier_id := (v_selection ->> 'modifier_option_id')::uuid;
    v_variant_id := nullif(v_selection ->> 'serving_variant_id', '')::uuid;

    if v_variant_id is not null then
      select price_delta into v_modifier_price
        from modifier_option_serving_variants
        where id = v_variant_id and modifier_option_id = v_modifier_id and is_active;
      if v_modifier_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;
    else
      select price_delta into v_modifier_price
        from dish_modifier_options where id = v_modifier_id;
      if v_modifier_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;
    end if;

    insert into order_item_modifiers (order_item_id, modifier_option_id, serving_variant_id, price_delta_at_order)
      values (p_order_item_id, v_modifier_id, v_variant_id, v_modifier_price);
  end loop;

  return (v_unit_price * p_quantity) + coalesce(
    (select sum(price_delta_at_order) from order_item_modifiers where order_item_id = p_order_item_id) * p_quantity,
    0
  );
end;
$$;

-- Staff-only notification (2026-10-11) — mirrors notify_order_item_cancelled
-- exactly (same label/account-suffix construction), minus the diner's own
-- copy: the diner just made this edit themselves, so there's nothing to
-- confirm back to them beyond the in-app save itself (same reasoning
-- already applied to resolve-waiter-call's own no-push decision). Called by
-- update-order-item right after a successful "update" action.
create function notify_order_item_updated(p_order_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_dish_name text;
  v_quantity int;
  v_table_type text;
  v_table_number text;
  v_session_account_number text;
  v_sub_account_number text;
  v_bar_ticket_number int;
  v_label text;
  v_account_suffix text;
begin
  select ts.restaurant_id, d.name, oi.quantity, t.table_type, t.table_number,
         o.bar_ticket_number, ts.session_account_number, sp.sub_account_number
    into v_restaurant_id, v_dish_name, v_quantity, v_table_type, v_table_number,
         v_bar_ticket_number, v_session_account_number, v_sub_account_number
    from order_items oi
    join orders o on o.id = oi.order_id
    join session_participants sp on sp.id = o.participant_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join dishes d on d.id = oi.dish_id
    where oi.id = p_order_item_id;

  if v_restaurant_id is null then
    return;
  end if;

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  v_account_suffix := case when v_table_type = 'bar' or v_sub_account_number is null
    then ''
    else ' · חשבון ' || coalesce(v_session_account_number, '—') || '-' || v_sub_account_number
  end;

  insert into notifications (staff_id, type, title, body, related_order_item_id)
    select s.id, 'order_status', 'המנה עודכנה לאחר כניסה למטבח - ' || v_label,
           v_quantity || 'x ' || v_dish_name || v_account_suffix, p_order_item_id
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;
end;
$$;
