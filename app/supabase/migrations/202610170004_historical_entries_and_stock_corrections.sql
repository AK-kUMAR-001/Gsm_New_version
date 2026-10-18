begin;

create or replace function public.inventory_apply_sale_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_product public.products;
  v_product_matches integer;
  v_quantity numeric(14, 3);
  v_quantity_on_hand numeric(14, 3);
  v_inventory_value numeric(14, 2);
  v_unit_cost numeric(14, 2);
  v_today date := public.inventory_today_ist();
  v_sale_kind text := tg_table_name;
begin
  if new.sale_date is null or new.sale_date > v_today then
    raise exception 'Sale date cannot be in the future.';
  end if;

  select count(*) into v_product_matches from public.products where name = new.product;
  if v_product_matches = 0 then
    raise exception 'Product not found in the catalog.';
  end if;
  if v_product_matches > 1 then
    raise exception 'Product name matches multiple catalog entries; resolve duplicate names before recording a sale.';
  end if;
  select * into v_product from public.products where name = new.product for update;
  if not found then
    raise exception 'Product not found in the catalog.';
  end if;
  if not v_product.active then
    raise exception 'This product is inactive. Activate it before recording a sale.';
  end if;
  if new.quantity_unit is null then
    new.quantity_unit := v_product.sales_unit;
  end if;
  if new.quantity_unit not in (v_product.sales_unit, v_product.stock_entry_unit) then
    raise exception 'Choose a valid sale unit for this product.';
  end if;
  v_product_id := v_product.id;

  perform 1 from public.inventory_product_settings
  where product_id = v_product_id for update;
  if not found then
    return new;
  end if;

  if not exists (
    select 1 from public.inventory_daily_counts
    where product_id = v_product_id and stock_date = new.sale_date
  ) then
    raise exception 'Record the physical stock count for this date before entering a tracked sale.';
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
  where product_id = v_product_id and movement_date = new.sale_date;

  if v_quantity > v_quantity_on_hand then
    raise exception 'Insufficient stock: % % available on this date, % requested.',
      v_quantity_on_hand, v_product.sales_unit, v_quantity;
  end if;
  v_unit_cost := case when v_quantity_on_hand > 0 then v_inventory_value / v_quantity_on_hand else 0 end;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    quantity_unit, source_kind, source_id, reason, recorded_by
  )
  values (
    v_product_id, 'sale', -v_quantity,
    round(-v_quantity * v_unit_cost, 2), new.sale_date,
    v_product.sales_unit, v_sale_kind, new.id, 'Sale', auth.uid()
  );

  return new;
end;
$$;

create or replace function public.inventory_set_stock_quantity_for_date(
  p_product_id uuid,
  p_stock_date date,
  p_target_quantity numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_request_id uuid default null
)
returns numeric(14, 3)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_quantity numeric(14, 3);
  v_current_value numeric(14, 2);
  v_target_quantity numeric(14, 3);
  v_quantity_delta numeric(14, 3);
  v_unit_cost numeric(14, 2);
  v_reason text := nullif(trim(p_reason), '');
  v_enabled_at timestamptz;
  v_movement public.inventory_stock_movements%rowtype;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can correct a historical stock balance.';
  end if;
  if p_stock_date is null or p_stock_date > public.inventory_today_ist() then
    raise exception 'Choose a valid stock date that is not in the future.';
  end if;
  if p_target_quantity is null or p_target_quantity < 0 then
    raise exception 'Corrected stock balance cannot be negative.';
  end if;
  if v_reason is null then
    raise exception 'Enter a reason for the stock correction.';
  end if;
  if p_request_id is null then
    raise exception 'A stock correction request ID is required.';
  end if;

  select enabled_at into v_enabled_at
  from public.inventory_product_settings
  where product_id = p_product_id for update;
  if not found or v_enabled_at is null then
    raise exception 'Start stock tracking for this product first.';
  end if;
  if p_stock_date < (v_enabled_at at time zone 'Asia/Kolkata')::date then
    raise exception 'Stock cannot be corrected before tracking started for this product.';
  end if;

  select * into v_movement
  from public.inventory_stock_movements
  where source_kind = 'adjustment' and source_id = p_request_id
  for update;
  if found then
    if v_movement.product_id is distinct from p_product_id
      or v_movement.movement_type is distinct from 'correction'
      or v_movement.movement_date is distinct from p_stock_date
      or v_movement.reason is distinct from v_reason then
      raise exception 'Correction request ID was already used for different stock details.';
    end if;
    return p_target_quantity;
  end if;

  select coalesce(sum(quantity_delta), 0), coalesce(sum(cost_delta), 0)
  into v_current_quantity, v_current_value
  from public.inventory_stock_movements
  where product_id = p_product_id and movement_date = p_stock_date;

  v_target_quantity := round(p_target_quantity, 3);
  v_quantity_delta := v_target_quantity - v_current_quantity;
  if v_quantity_delta = 0 then
    return v_target_quantity;
  end if;

  if v_quantity_delta > 0 then
    v_unit_cost := coalesce(
      p_unit_cost,
      case when v_current_quantity > 0 then v_current_value / v_current_quantity end
    );
    if v_unit_cost is null or v_unit_cost <= 0 then
      raise exception 'Enter an estimated cost per sales unit for added historical stock.';
    end if;
  else
    if v_current_quantity <= 0 then
      raise exception 'There is no stock available on this date to remove.';
    end if;
    v_unit_cost := v_current_value / v_current_quantity;
  end if;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    source_kind, source_id, reason, recorded_by
  )
  values (
    p_product_id, 'correction', v_quantity_delta,
    round(v_quantity_delta * v_unit_cost, 2), p_stock_date,
    'adjustment', p_request_id, v_reason, auth.uid()
  );

  return v_target_quantity;
end;
$$;

revoke all on function public.inventory_set_stock_quantity_for_date(uuid, date, numeric, text, numeric, uuid) from public, anon;
grant execute on function public.inventory_set_stock_quantity_for_date(uuid, date, numeric, text, numeric, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
