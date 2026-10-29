begin;

create table if not exists app_private.inventory_historical_count_entries (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  stock_date date not null,
  counted_quantity numeric(14, 3) not null,
  unit_cost numeric(14, 6),
  previous_movements jsonb not null,
  recorded_by uuid not null default auth.uid(),
  recorded_at timestamptz not null default now()
);

revoke all on app_private.inventory_historical_count_entries
  from public, anon, authenticated;

create or replace function public.inventory_record_historical_morning_count(
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
  v_product public.products%rowtype;
  v_enabled_at timestamptz;
  v_count public.inventory_daily_counts;
  v_movement public.inventory_stock_movements%rowtype;
  v_existing_movements jsonb;
  v_counted_quantity numeric(14, 3);
  v_unit_cost numeric(14, 6);
  v_count_cost numeric(14, 2);
  v_count_created_at timestamptz;
  v_balance_quantity numeric(14, 3) := 0;
  v_balance_value numeric(14, 2) := 0;
  v_new_cost_delta numeric(14, 2);
  v_missing_sales integer;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can record a historical morning count.';
  end if;
  if p_stock_date is null or p_stock_date >= v_today then
    raise exception 'Choose a past stock date. Use Daily Stock In to record today''s count.';
  end if;
  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'Morning stock cannot be negative.';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Purchase cost cannot be negative.';
  end if;
  if p_counted_quantity > 0 and (p_unit_cost is null or p_unit_cost <= 0) then
    raise exception 'Enter the purchase cost per unit for the historical morning stock.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('historical-stock:' || p_product_id::text || ':' || p_stock_date::text, 0)
  );

  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Product not found.';
  end if;

  select enabled_at into v_enabled_at
  from public.inventory_product_settings
  where product_id = p_product_id
  for update;
  if not found then
    raise exception 'Start stock tracking for this product first.';
  end if;
  if p_stock_date < (v_enabled_at at time zone 'Asia/Kolkata')::date then
    raise exception 'A morning count cannot be recorded before stock tracking started for this product.';
  end if;

  if exists (
    select 1
    from public.inventory_daily_counts
    where product_id = p_product_id and stock_date = p_stock_date
  ) then
    raise exception 'A morning count already exists for this product and date. Use Correct morning count instead.';
  end if;

  if exists (
    select 1
    from public.inventory_stock_movements
    where product_id = p_product_id
      and movement_date = p_stock_date
      and movement_type in ('opening', 'count_adjustment', 'count_revaluation')
  ) then
    raise exception 'Existing opening/count movements need reconciliation before adding a missing morning count.';
  end if;

  select count(*) into v_missing_sales
  from public.buyer_sales sale
  where sale.product = v_product.name
    and sale.sale_date = p_stock_date
    and not exists (
      select 1 from public.inventory_stock_movements movement
      where movement.product_id = p_product_id
        and movement.movement_type = 'sale'
        and movement.source_kind = 'buyer_sales'
        and movement.source_id = sale.id
        and movement.movement_date = p_stock_date
    );

  select v_missing_sales + count(*) into v_missing_sales
  from public.retail_sales sale
  where sale.product = v_product.name
    and sale.sale_date = p_stock_date
    and not exists (
      select 1 from public.inventory_stock_movements movement
      where movement.product_id = p_product_id
        and movement.movement_type = 'sale'
        and movement.source_kind = 'retail_sales'
        and movement.source_id = sale.id
        and movement.movement_date = p_stock_date
    );

  if v_missing_sales > 0 then
    raise exception 'Some saved sales have no linked stock movement. Reconcile those movements before recording this count.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.created_at, movement.id), '[]'::jsonb)
  into v_existing_movements
  from public.inventory_stock_movements movement
  where movement.product_id = p_product_id
    and movement.movement_date = p_stock_date;

  select min(created_at) into v_count_created_at
  from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = p_stock_date;

  v_count_created_at := coalesce(
    v_count_created_at - interval '1 microsecond',
    (p_stock_date::timestamp at time zone 'Asia/Kolkata')
  );
  v_counted_quantity := round(p_counted_quantity, 3);
  v_unit_cost := case when v_counted_quantity > 0 then p_unit_cost else null end;
  v_count_cost := round(v_counted_quantity * coalesce(v_unit_cost, 0), 2);

  insert into app_private.inventory_historical_count_entries (
    product_id, stock_date, counted_quantity, unit_cost, previous_movements, recorded_by
  )
  values (
    p_product_id, p_stock_date, v_counted_quantity, v_unit_cost,
    v_existing_movements, auth.uid()
  );

  insert into public.inventory_daily_counts (
    product_id, stock_date, counted_quantity, expected_quantity,
    variance_quantity, recorded_by, created_at, quantity_unit
  )
  values (
    p_product_id, p_stock_date, v_counted_quantity, 0,
    v_counted_quantity, auth.uid(), v_count_created_at, v_product.sales_unit
  )
  returning * into v_count;

  if v_counted_quantity > 0 then
    insert into public.inventory_stock_movements (
      product_id, movement_type, quantity_delta, cost_delta, movement_date,
      quantity_unit, reason, recorded_by, created_at
    )
    values (
      p_product_id, 'count_adjustment', v_counted_quantity, v_count_cost,
      p_stock_date, v_product.sales_unit, 'Historical morning physical count recorded',
      auth.uid(), v_count_created_at
    );
  end if;

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
        raise exception 'The morning count cannot cover this date''s recorded stock movements.';
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

  if v_balance_quantity < 0 then
    raise exception 'The morning count results in a negative closing balance.';
  end if;

  return v_count;
end;
$$;

revoke all on function public.inventory_record_historical_morning_count(uuid, date, numeric, numeric)
  from public, anon;
grant execute on function public.inventory_record_historical_morning_count(uuid, date, numeric, numeric)
  to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202610290001_record_historical_morning_count')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
