SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calculate_bill_split (
  p_payment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  v_split_type text;
  v_total numeric(10, 2);
  v_participant_count int;
begin
  select split_type, total_amount into v_split_type, v_total
  from payments where id = p_payment_id
  for update;

  if v_split_type = 'even' then
    select count(*) into v_participant_count
    from payment_participant_shares
    where payment_id = p_payment_id;

    update payment_participant_shares
      set amount_due = round(v_total / v_participant_count, 2)
      where payment_id = p_payment_id;

  elsif v_split_type = 'by_item' then
    update payment_participant_shares pps
      set amount_due = coalesce((
        select sum(oi.unit_price * oi.quantity)
        from orders o
        join order_items oi on oi.order_id = o.id
        where o.participant_id = pps.participant_id
      ), 0);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.current_manager_restaurant_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select restaurant_id from staff where user_id = auth.uid() and role = 'manager' and is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_restaurant_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select restaurant_id from staff where user_id = auth.uid() and is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.register_restaurant (
  p_user_id       uuid,
  p_name          text,
  p_address       text,
  p_phone         text,
  p_hours         jsonb,
  p_kosher_status text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_restaurant_id uuid;
begin
  insert into restaurants (name, address, phone, hours, kosher_status, onboarding_status, created_by)
  values (p_name, p_address, p_phone, p_hours, p_kosher_status, 'draft', p_user_id)
  returning id into v_restaurant_id;

  insert into staff (restaurant_id, user_id, role)
  values (v_restaurant_id, p_user_id, 'manager');

  return v_restaurant_id;
end;
$function$;

