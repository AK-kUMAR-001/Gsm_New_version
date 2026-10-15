begin;

create or replace view public.inventory_stock_summary
with (security_invoker = true)
as
select
  setting.product_id,
  coalesce(sum(movement.quantity_delta), 0)::numeric(14, 3) as quantity_on_hand,
  coalesce(sum(movement.cost_delta), 0)::numeric(14, 2) as inventory_value,
  case
    when coalesce(sum(movement.quantity_delta), 0) > 0
      then round(sum(movement.cost_delta) / sum(movement.quantity_delta), 2)
    else null
  end as average_unit_cost,
  setting.enabled_at
from public.inventory_product_settings as setting
left join public.inventory_stock_movements as movement
  on movement.product_id = setting.product_id
  and movement.movement_date = public.inventory_today_ist()
group by setting.product_id, setting.enabled_at;

create or replace function public.inventory_record_morning_count(
  p_product_id uuid,
  p_counted_quantity numeric,
  p_surplus_unit_cost numeric default null
)
returns public.inventory_daily_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected numeric(14, 3);
  v_value numeric(14, 2);
  v_variance numeric(14, 3);
  v_unit_cost numeric(14, 2);
  v_count public.inventory_daily_counts;
  v_today date := public.inventory_today_ist();
  v_unit text;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can record a stock count.';
  end if;
  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'Counted stock cannot be negative.';
  end if;

  perform 1 from public.inventory_product_settings
    where product_id = p_product_id for update;
  if not found then
    raise exception 'Start stock tracking with an opening quantity first.';
  end if;

  select sales_unit into v_unit
  from public.products
  where id = p_product_id;
  if v_unit is null then
    raise exception 'Product unit configuration was not found.';
  end if;

  if exists (
    select 1 from public.inventory_daily_counts
    where product_id = p_product_id and stock_date = v_today
  ) then
    raise exception 'A morning count is already recorded for this product today.';
  end if;

  select
    coalesce(sum(quantity_delta), 0),
    coalesce(sum(cost_delta), 0)
  into v_expected, v_value
  from public.inventory_stock_movements
  where product_id = p_product_id and movement_date = v_today;

  v_variance := p_counted_quantity - v_expected;
  if v_variance > 0 then
    if v_expected > 0 then
      v_unit_cost := round(v_value / v_expected, 2);
    elsif p_surplus_unit_cost is not null and p_surplus_unit_cost > 0 then
      v_unit_cost := round(p_surplus_unit_cost, 2);
    else
      raise exception 'Enter an estimated cost per % for the additional counted stock.', v_unit;
    end if;

    insert into public.inventory_stock_movements (
      product_id, movement_type, quantity_delta, cost_delta, movement_date, reason, recorded_by
    )
    values (
      p_product_id, 'count_adjustment', v_variance,
      round(v_variance * v_unit_cost, 2), v_today,
      'Morning physical count surplus', auth.uid()
    );
  elsif v_variance < 0 then
    if v_expected <= 0 then
      raise exception 'Count variance cannot reduce an empty stock balance.';
    end if;
    v_unit_cost := round(v_value / v_expected, 2);
    insert into public.inventory_stock_movements (
      product_id, movement_type, quantity_delta, cost_delta, movement_date, reason, recorded_by
    )
    values (
      p_product_id, 'count_adjustment', v_variance,
      round(v_variance * v_unit_cost, 2), v_today,
      'Morning physical count shortage', auth.uid()
    );
  end if;

  insert into public.inventory_daily_counts (
    product_id, stock_date, counted_quantity, expected_quantity, variance_quantity, recorded_by
  )
  values (
    p_product_id, v_today, p_counted_quantity, v_expected, v_variance, auth.uid()
  )
  returning * into v_count;

  return v_count;
end;
$$;

create or replace function public.inventory_record_adjustment(
  p_product_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_request_id uuid default null
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity numeric(14, 3);
  v_value numeric(14, 2);
  v_unit_cost numeric(14, 2);
  v_movement public.inventory_stock_movements;
  v_delta numeric(14, 3);
  v_today date := public.inventory_today_ist();
  v_reason text := trim(p_reason);
  v_unit text;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can record a stock adjustment.';
  end if;
  if p_movement_type not in ('spoilage', 'correction') then
    raise exception 'Choose damaged stock or correction.';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Adjustment quantity cannot be zero.';
  end if;
  if p_request_id is null then
    raise exception 'A stock adjustment request ID is required.';
  end if;
  if p_movement_type = 'spoilage' and p_quantity_delta >= 0 then
    raise exception 'Spoilage quantity must be entered as a positive amount to remove.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Enter a reason for the stock adjustment.';
  end if;
  v_delta := p_quantity_delta;

  perform 1 from public.inventory_product_settings
    where product_id = p_product_id for update;
  if not found then
    raise exception 'Start stock tracking for this product first.';
  end if;

  select sales_unit into v_unit
  from public.products
  where id = p_product_id;
  if v_unit is null then
    raise exception 'Product unit configuration was not found.';
  end if;

  select * into v_movement
  from public.inventory_stock_movements
  where source_kind = 'adjustment' and source_id = p_request_id;
  if found then
    if v_movement.product_id is distinct from p_product_id
      or v_movement.movement_type is distinct from p_movement_type
      or v_movement.quantity_delta is distinct from v_delta
      or v_movement.reason is distinct from v_reason then
      raise exception 'Adjustment request ID was already used for different stock details.';
    end if;
    if v_delta > 0 and p_unit_cost is not null
      and v_movement.cost_delta is distinct from round(v_delta * p_unit_cost, 2) then
      raise exception 'Adjustment request ID was already used for different stock details.';
    end if;
    return v_movement;
  end if;

  select coalesce(sum(quantity_delta), 0), coalesce(sum(cost_delta), 0)
  into v_quantity, v_value
  from public.inventory_stock_movements
  where product_id = p_product_id and movement_date = v_today;

  if v_quantity + v_delta < 0 then
    raise exception 'Adjustment exceeds today''s available stock.';
  end if;
  if v_delta > 0 then
    v_unit_cost := coalesce(p_unit_cost, case when v_quantity > 0 then v_value / v_quantity end);
    if v_unit_cost is null or v_unit_cost <= 0 then
      raise exception 'Enter an estimated cost per % for additional stock.', v_unit;
    end if;
  else
    if v_quantity <= 0 then
      raise exception 'There is no stock available today to remove.';
    end if;
    v_unit_cost := v_value / v_quantity;
  end if;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    source_kind, source_id, reason, recorded_by
  )
  values (
    p_product_id, p_movement_type, v_delta,
    round(v_delta * v_unit_cost, 2), v_today,
    'adjustment', p_request_id, v_reason, auth.uid()
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

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
  if new.sale_date is distinct from v_today then
    raise exception 'Sales must be dated today in the India time zone.';
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
  new.quantity_unit := v_product.sales_unit;
  v_product_id := v_product.id;

  perform 1 from public.inventory_product_settings
    where product_id = v_product_id for update;
  if not found then
    raise exception 'Stock tracking has not started. Enter opening stock before recording a sale.';
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
  where product_id = v_product_id and movement_date = v_today;

  if v_quantity > v_quantity_on_hand then
    raise exception 'Insufficient stock: % % available today, % requested.',
      v_quantity_on_hand, v_product.sales_unit, v_quantity;
  end if;
  v_unit_cost := case when v_quantity_on_hand > 0 then v_inventory_value / v_quantity_on_hand else 0 end;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    quantity_unit, source_kind, source_id, reason, recorded_by
  )
  values (
    v_product_id, 'sale', -v_quantity,
    round(-v_quantity * v_unit_cost, 2), v_today,
    v_product.sales_unit, v_sale_kind, new.id, 'Sale', auth.uid()
  );

  return new;
end;
$$;

create or replace function public.inventory_set_stock_quantity(
  p_product_id uuid,
  p_target_quantity numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_request_id uuid default null
)
returns numeric(14, 3)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_quantity numeric(14, 3);
  v_target_quantity numeric(14, 3);
  v_quantity_delta numeric(14, 3);
begin
  if p_target_quantity is null or p_target_quantity < 0 then
    raise exception 'Corrected stock balance cannot be negative.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Enter a reason for the stock correction.';
  end if;
  if p_request_id is null then
    raise exception 'A stock correction request ID is required.';
  end if;

  perform 1
  from public.inventory_product_settings
  where product_id = p_product_id
  for update;
  if not found then
    raise exception 'Start stock tracking for this product first.';
  end if;

  select coalesce(sum(quantity_delta), 0)
  into v_current_quantity
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = public.inventory_today_ist();

  v_target_quantity := round(p_target_quantity, 3);
  v_quantity_delta := v_target_quantity - v_current_quantity;

  if v_quantity_delta <> 0 then
    perform public.inventory_record_adjustment(
      p_product_id,
      'correction',
      v_quantity_delta,
      p_reason,
      p_unit_cost,
      p_request_id
    );
  end if;

  return v_target_quantity;
end;
$$;

notify pgrst, 'reload schema';
commit;
