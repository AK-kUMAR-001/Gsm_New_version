begin;

create table if not exists app_private.inventory_historical_count_corrections (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  stock_date date not null,
  previous_count jsonb not null,
  previous_count_movements jsonb not null,
  corrected_counted_quantity numeric(14, 3) not null,
  corrected_unit_cost numeric(14, 6),
  corrected_by uuid not null default auth.uid(),
  corrected_at timestamptz not null default now()
);

revoke all on app_private.inventory_historical_count_corrections
  from public, anon, authenticated;

create or replace function public.inventory_correct_historical_morning_count(
  p_product_id uuid,
  p_stock_date date,
  p_counted_quantity numeric,
  p_unit_cost numeric
)
returns public.inventory_daily_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.inventory_today_ist();
  v_count public.inventory_daily_counts;
  v_movement public.inventory_stock_movements;
  v_count_adjustment_id bigint;
  v_revaluation_id bigint;
  v_adjustment_count integer;
  v_revaluation_count integer;
  v_unit text;
  v_counted_quantity numeric(14, 3);
  v_base_quantity numeric(14, 3);
  v_base_value numeric(14, 2);
  v_target_value numeric(14, 2);
  v_variance numeric(14, 3);
  v_count_cost_delta numeric(14, 2);
  v_balance_quantity numeric(14, 3) := 0;
  v_balance_value numeric(14, 2) := 0;
  v_new_cost_delta numeric(14, 2);
  v_previous_count jsonb;
  v_previous_movements jsonb;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can correct a historical morning count.';
  end if;
  if p_stock_date is null or p_stock_date >= v_today then
    raise exception 'Choose a past stock date. Use the Daily Stock In page to correct today''s count.';
  end if;
  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'Morning stock cannot be negative.';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Purchase cost cannot be negative.';
  end if;
  if p_counted_quantity > 0 and (p_unit_cost is null or p_unit_cost <= 0) then
    raise exception 'Enter the purchase cost per unit for the corrected morning stock.';
  end if;

  perform 1
  from public.inventory_product_settings
  where product_id = p_product_id
  for update;
  if not found then
    raise exception 'Start stock tracking for this product first.';
  end if;

  select sales_unit into v_unit
  from public.products
  where id = p_product_id;
  if v_unit is null then
    raise exception 'Product unit configuration was not found.';
  end if;

  select * into v_count
  from public.inventory_daily_counts
  where product_id = p_product_id and stock_date = p_stock_date
  for update;
  if not found then
    raise exception 'A physical morning count must already exist for this date.';
  end if;

  select count(*) into v_adjustment_count
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = p_stock_date
    and movement_type = 'count_adjustment'
    and reason like 'Morning physical count %';

  select count(*) into v_revaluation_count
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = p_stock_date
    and movement_type = 'count_revaluation'
    and reason = 'Morning physical count valuation correction';

  if v_adjustment_count > 1 or v_revaluation_count > 1 then
    raise exception 'Multiple morning-count valuation movements need review before this count can be corrected.';
  end if;

  select id into v_count_adjustment_id
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = p_stock_date
    and movement_type = 'count_adjustment'
    and reason like 'Morning physical count %'
  order by created_at, id
  limit 1
  for update;

  select id into v_revaluation_id
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = p_stock_date
    and movement_type = 'count_revaluation'
    and reason = 'Morning physical count valuation correction'
  order by created_at, id
  limit 1
  for update;

  select coalesce(sum(quantity_delta), 0), coalesce(sum(cost_delta), 0)
  into v_base_quantity, v_base_value
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = p_stock_date
    and created_at <= v_count.created_at
    and id is distinct from v_count_adjustment_id
    and id is distinct from v_revaluation_id;

  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.created_at, movement.id), '[]'::jsonb)
  into v_previous_movements
  from public.inventory_stock_movements as movement
  where movement.product_id = p_product_id
    and movement.movement_date = p_stock_date
    and movement.id in (v_count_adjustment_id, v_revaluation_id);

  v_previous_count := to_jsonb(v_count);
  insert into app_private.inventory_historical_count_corrections (
    product_id,
    stock_date,
    previous_count,
    previous_count_movements,
    corrected_counted_quantity,
    corrected_unit_cost
  )
  values (
    p_product_id,
    p_stock_date,
    v_previous_count,
    v_previous_movements,
    round(p_counted_quantity, 3),
    case when p_counted_quantity > 0 then p_unit_cost else null end
  );

  v_counted_quantity := round(p_counted_quantity, 3);
  v_variance := v_counted_quantity - v_base_quantity;
  v_target_value := round(v_counted_quantity * coalesce(p_unit_cost, 0), 2);
  v_count_cost_delta := v_target_value - v_base_value;

  if v_variance <> 0 then
    if v_count_adjustment_id is null then
      insert into public.inventory_stock_movements (
        product_id, movement_type, quantity_delta, cost_delta, movement_date,
        quantity_unit, reason, recorded_by, created_at
      )
      values (
        p_product_id, 'count_adjustment', v_variance, v_count_cost_delta,
        p_stock_date, v_unit, 'Morning physical count corrected',
        auth.uid(), v_count.created_at
      )
      returning id into v_count_adjustment_id;
    else
      update public.inventory_stock_movements
      set quantity_delta = v_variance,
          cost_delta = v_count_cost_delta,
          quantity_unit = v_unit,
          reason = 'Morning physical count corrected',
          recorded_by = auth.uid(),
          created_at = v_count.created_at
      where id = v_count_adjustment_id;
    end if;
    if v_revaluation_id is not null then
      delete from public.inventory_stock_movements where id = v_revaluation_id;
      v_revaluation_id := null;
    end if;
  else
    if v_count_adjustment_id is not null then
      delete from public.inventory_stock_movements where id = v_count_adjustment_id;
      v_count_adjustment_id := null;
    end if;
    if v_count_cost_delta <> 0 then
      if v_revaluation_id is null then
        insert into public.inventory_stock_movements (
          product_id, movement_type, quantity_delta, cost_delta, movement_date,
          quantity_unit, reason, recorded_by, created_at
        )
        values (
          p_product_id, 'count_revaluation', 0, v_count_cost_delta,
          p_stock_date, v_unit, 'Morning physical count valuation correction',
          auth.uid(), v_count.created_at
        )
        returning id into v_revaluation_id;
      else
        update public.inventory_stock_movements
        set cost_delta = v_count_cost_delta,
            quantity_unit = v_unit,
            recorded_by = auth.uid(),
            created_at = v_count.created_at
        where id = v_revaluation_id;
      end if;
    elsif v_revaluation_id is not null then
      delete from public.inventory_stock_movements where id = v_revaluation_id;
      v_revaluation_id := null;
    end if;
  end if;

  update public.inventory_daily_counts
  set counted_quantity = v_counted_quantity,
      expected_quantity = v_base_quantity,
      variance_quantity = v_variance,
      quantity_unit = v_unit,
      recorded_by = auth.uid()
  where product_id = p_product_id and stock_date = p_stock_date
  returning * into v_count;

  for v_movement in
    select *
    from public.inventory_stock_movements
    where product_id = p_product_id and movement_date = p_stock_date
    order by created_at, id
    for update
  loop
    if v_movement.quantity_delta < 0
      and (
        v_movement.movement_type in ('sale', 'spoilage')
        or v_movement.movement_type = 'correction'
      ) then
      if v_balance_quantity <= 0
        or v_balance_quantity + v_movement.quantity_delta < 0 then
        raise exception 'Corrected morning stock is insufficient for the recorded stock movements on this date.';
      end if;
      v_new_cost_delta := round(
        v_movement.quantity_delta * (v_balance_value / v_balance_quantity),
        2
      );
      update public.inventory_stock_movements
      set cost_delta = v_new_cost_delta
      where id = v_movement.id;
      v_movement.cost_delta := v_new_cost_delta;
    end if;

    v_balance_quantity := v_balance_quantity + v_movement.quantity_delta;
    v_balance_value := v_balance_value + v_movement.cost_delta;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.inventory_correct_historical_morning_count(uuid, date, numeric, numeric)
  from public, anon;
grant execute on function public.inventory_correct_historical_morning_count(uuid, date, numeric, numeric)
  to authenticated;

notify pgrst, 'reload schema';
commit;
