create or replace function public.inventory_apply_sale_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_product_matches integer;
  v_quantity numeric(14, 3);
  v_quantity_on_hand numeric(14, 3);
  v_inventory_value numeric(14, 2);
  v_unit_cost numeric(14, 2);
  v_today date := public.inventory_today_ist();
  v_sale_kind text := tg_table_name;
begin
  select count(*) into v_product_matches
  from public.products
  where name = new.product;

  if v_product_matches = 0 then
    raise exception 'Product not found in the catalog. Add the product and enter its opening stock before recording a sale.';
  end if;
  if v_product_matches > 1 then
    raise exception 'Product name matches multiple catalog entries; resolve duplicate names before recording a sale.';
  end if;

  select id into v_product_id from public.products where name = new.product;

  perform 1 from public.inventory_product_settings
    where product_id = v_product_id for update;
  if not found then
    raise exception 'Stock tracking has not started. Enter opening stock before recording a sale.';
  end if;

  if new.sale_date is distinct from v_today then
    raise exception 'Sales must be dated today in the India time zone.';
  end if;

  if not exists (
    select 1 from public.inventory_daily_counts
    where product_id = v_product_id and stock_date = v_today
  ) then
    raise exception 'Record today''s physical stock count before selling this product.';
  end if;

  if tg_table_name = 'buyer_sales' then
    v_quantity := new.mootais;
  else
    v_quantity := new.mootais_sold;
  end if;
  if v_quantity is null or v_quantity <= 0 then
    raise exception 'Sale quantity must be greater than zero.';
  end if;

  select coalesce(sum(quantity_delta), 0), coalesce(sum(cost_delta), 0)
  into v_quantity_on_hand, v_inventory_value
  from public.inventory_stock_movements
  where product_id = v_product_id;

  if v_quantity > v_quantity_on_hand then
    raise exception 'Insufficient stock: % Mootais available, % requested.',
      v_quantity_on_hand, v_quantity;
  end if;
  v_unit_cost := case when v_quantity_on_hand > 0 then v_inventory_value / v_quantity_on_hand else 0 end;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    source_kind, source_id, reason, recorded_by
  )
  values (
    v_product_id, 'sale', -v_quantity,
    round(-v_quantity * v_unit_cost, 2), v_today,
    v_sale_kind, new.id, 'Sale', auth.uid()
  );

  return new;
end;
$$;

create or replace function public.inventory_start_tracking_with_count(
  p_product_id uuid,
  p_opening_quantity numeric,
  p_estimated_unit_cost numeric,
  p_damaged_quantity numeric,
  p_damage_reason text,
  p_damage_request_id uuid
)
returns public.inventory_daily_counts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count public.inventory_daily_counts;
  v_is_tracked boolean;
begin
  if p_damaged_quantity is null or p_damaged_quantity < 0 then
    raise exception 'Damaged quantity cannot be negative.';
  end if;
  if p_opening_quantity is null or p_opening_quantity < 0 then
    raise exception 'Opening stock cannot be negative.';
  end if;
  if p_damaged_quantity > p_opening_quantity then
    raise exception 'Damaged quantity cannot exceed the opening quantity.';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found.';
  end if;

  select exists (
    select 1 from public.inventory_product_settings where product_id = p_product_id
  ) into v_is_tracked;

  if v_is_tracked then
    select * into v_count
    from public.inventory_daily_counts
    where product_id = p_product_id
      and stock_date = public.inventory_today_ist();
    if not found then
      raise exception 'Stock tracking has started. Record today''s physical stock count instead.';
    end if;
    if v_count.counted_quantity is distinct from round(p_opening_quantity, 3) then
      raise exception 'Opening stock was already recorded with a different quantity.';
    end if;
    return v_count;
  end if;

  perform public.inventory_start_tracking(
    p_product_id,
    p_opening_quantity,
    p_estimated_unit_cost
  );
  v_count := public.inventory_record_morning_count(
    p_product_id,
    p_opening_quantity,
    p_estimated_unit_cost
  );

  if p_damaged_quantity > 0 then
    if p_damage_request_id is null then
      raise exception 'A damage record request ID is required.';
    end if;
    perform public.inventory_record_adjustment(
      p_product_id,
      'spoilage',
      -p_damaged_quantity,
      coalesce(nullif(trim(p_damage_reason), ''), 'Damaged during opening stock entry'),
      null,
      p_damage_request_id
    );
  end if;

  return v_count;
end;
$$;

create or replace function public.inventory_record_receipt_with_damage(
  p_product_id uuid,
  p_supplier_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_notes text,
  p_request_id uuid,
  p_damaged_quantity numeric,
  p_damage_reason text,
  p_damage_request_id uuid
)
returns public.inventory_stock_movements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_receipt public.inventory_stock_movements;
begin
  if p_damaged_quantity is null or p_damaged_quantity < 0 then
    raise exception 'Damaged quantity cannot be negative.';
  end if;
  if p_damaged_quantity > p_quantity then
    raise exception 'Damaged quantity cannot exceed the received quantity.';
  end if;

  v_receipt := public.inventory_record_receipt(
    p_product_id,
    p_supplier_id,
    p_quantity,
    p_unit_cost,
    p_notes,
    p_request_id
  );

  if p_damaged_quantity > 0 then
    if p_damage_request_id is null then
      raise exception 'A damage record request ID is required.';
    end if;
    perform public.inventory_record_adjustment(
      p_product_id,
      'spoilage',
      -p_damaged_quantity,
      coalesce(nullif(trim(p_damage_reason), ''), 'Damaged during stock receipt'),
      null,
      p_damage_request_id
    );
  end if;

  return v_receipt;
end;
$$;

revoke all on function public.inventory_start_tracking_with_count(uuid, numeric, numeric, numeric, text, uuid) from public, anon;
revoke all on function public.inventory_record_receipt_with_damage(uuid, uuid, numeric, numeric, text, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.inventory_start_tracking_with_count(uuid, numeric, numeric, numeric, text, uuid) to authenticated;
grant execute on function public.inventory_record_receipt_with_damage(uuid, uuid, numeric, numeric, text, uuid, numeric, text, uuid) to authenticated;
