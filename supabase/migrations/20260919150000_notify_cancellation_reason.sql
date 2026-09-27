-- Re-snapshot of notify_order_item_cancelled (20260919120000) — reads the
-- cancellation_reason the diner picked (already written by update-order-item
-- before this function runs) and folds it into both notification bodies, so
-- staff and the diner both see *why*, not just *what*.
create or replace function notify_order_item_cancelled(p_order_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_diner_user_id uuid;
  v_dish_name text;
  v_quantity int;
  v_cancellation_reason text;
  v_table_type text;
  v_table_number text;
  v_bar_ticket_number int;
  v_label text;
  v_reason_suffix text;
begin
  select ts.restaurant_id, sp.user_id, d.name, oi.quantity, oi.cancellation_reason, t.table_type, t.table_number, o.bar_ticket_number
    into v_restaurant_id, v_diner_user_id, v_dish_name, v_quantity, v_cancellation_reason, v_table_type, v_table_number, v_bar_ticket_number
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

  v_reason_suffix := case when v_cancellation_reason is not null then ' — ' || v_cancellation_reason else '' end;

  insert into notifications (staff_id, type, title, body)
    select s.id, 'order_status', 'הזמנה בוטלה - ' || v_label, v_quantity || 'x ' || v_dish_name || v_reason_suffix
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  -- "ללא חיוב" is stated explicitly, not just implied — reassurance the
  -- diner asked for, and factually true today regardless (no real payment
  -- charge exists yet; order_holds is still a Stage 6 stub).
  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body)
      values (v_diner_user_id, 'order_status', 'ההזמנה בוטלה', v_quantity || 'x ' || v_dish_name || ' בוטל בהצלחה וללא חיוב' || v_reason_suffix);
  end if;
end;
$$;
