begin;

lock table public.products,
  public.inventory_product_settings,
  public.inventory_daily_counts,
  public.inventory_stock_movements,
  public.buyer_sales,
  public.retail_sales
in share row exclusive mode;

create table if not exists app_private.inventory_oct22_stock_repair_audit (
  stock_date date primary key check (stock_date = date '2026-10-22'),
  previous_counts jsonb not null,
  previous_movements jsonb not null,
  buyer_sales_snapshot jsonb not null,
  retail_sales_snapshot jsonb not null,
  repaired_at timestamptz not null default now()
);

revoke all on app_private.inventory_oct22_stock_repair_audit from public, anon, authenticated;

do $$
declare
  v_product record;
  v_count public.inventory_daily_counts%rowtype;
  v_movement public.inventory_stock_movements%rowtype;
  v_product_ids uuid[];
  v_previous_counts jsonb;
  v_previous_movements jsonb;
  v_buyer_sales_snapshot jsonb;
  v_retail_sales_snapshot jsonb;
  v_count_event_time timestamptz;
  v_balance_quantity numeric(14, 3);
  v_balance_value numeric(14, 2);
  v_new_cost_delta numeric(14, 2);
begin
  if exists (
    select 1
    from app_private.inventory_oct22_stock_repair_audit
    where stock_date = date '2026-10-22'
  ) then
    raise exception 'The 22 Oct stock repair has already been applied.';
  end if;

  if (
    select count(*)
    from (values
      ('malli'::text, 'Kattu'::text, 'Mootai'::text, 50::numeric),
      ('pudina'::text, 'Kattu'::text, 'Mootai'::text, 200::numeric),
      ('karuvepillai'::text, 'Kg'::text, 'Kg'::text, 1::numeric)
    ) as expected(name, sales_unit, stock_unit, factor)
    join public.products as product
      on lower(btrim(product.name)) = expected.name
      and product.sales_unit = expected.sales_unit
      and product.stock_entry_unit = expected.stock_unit
      and product.stock_to_sales_factor = expected.factor
  ) <> 3 then
    raise exception 'Repair stopped: verified product units do not match the expected settings.';
  end if;

  select array_agg(product.id)
  into v_product_ids
  from public.products as product
  where lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai');

  if exists (
    select 1
    from public.products as product
    where product.id = any(v_product_ids)
      and not exists (
        select 1 from public.inventory_product_settings as setting
        where setting.product_id = product.id
      )
  ) then
    raise exception 'Repair stopped: stock tracking is not enabled for all three products.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.id = any(v_product_ids)
      and not exists (
        select 1 from public.inventory_daily_counts as daily_count
        where daily_count.product_id = product.id
          and daily_count.stock_date = date '2026-10-22'
      )
  ) then
    raise exception 'Repair stopped: a recorded 22 Oct morning count is missing.';
  end if;

  if exists (
    select 1
    from public.buyer_sales as sale
    join public.products as product
      on lower(btrim(product.name)) = lower(btrim(sale.product))
    where sale.sale_date = date '2026-10-22'
      and product.id = any(v_product_ids)
      and not exists (
        select 1
        from public.inventory_stock_movements as movement
        where movement.product_id = product.id
          and movement.movement_date = date '2026-10-22'
          and movement.movement_type = 'sale'
          and movement.source_kind = 'buyer_sales'
          and movement.source_id = sale.id
          and movement.quantity_delta = -sale.mootais
      )
  ) or exists (
    select 1
    from public.retail_sales as sale
    join public.products as product
      on lower(btrim(product.name)) = lower(btrim(sale.product))
    where sale.sale_date = date '2026-10-22'
      and product.id = any(v_product_ids)
      and not exists (
        select 1
        from public.inventory_stock_movements as movement
        where movement.product_id = product.id
          and movement.movement_date = date '2026-10-22'
          and movement.movement_type = 'sale'
          and movement.source_kind = 'retail_sales'
          and movement.source_id = sale.id
          and movement.quantity_delta = -sale.mootais_sold
      )
  ) then
    raise exception 'Repair stopped: one or more 22 Oct sales are missing a matching stock movement.';
  end if;

  if exists (
    select 1
    from public.inventory_stock_movements as movement
    where movement.movement_date = date '2026-10-22'
      and movement.movement_type = 'sale'
      and movement.product_id = any(v_product_ids)
      and not coalesce(
        (
          movement.source_kind = 'buyer_sales'
          and exists (
            select 1 from public.buyer_sales as sale
            where sale.id = movement.source_id
              and sale.sale_date = date '2026-10-22'
          )
        ) or (
          movement.source_kind = 'retail_sales'
          and exists (
            select 1 from public.retail_sales as sale
            where sale.id = movement.source_id
              and sale.sale_date = date '2026-10-22'
          )
        ),
        false
      )
  ) then
    raise exception 'Repair stopped: an orphaned 22 Oct sale movement needs review before stock can be rebuilt.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(daily_count) order by daily_count.product_id), '[]'::jsonb)
  into v_previous_counts
  from public.inventory_daily_counts as daily_count
  where daily_count.stock_date = date '2026-10-22'
    and daily_count.product_id = any(v_product_ids);

  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.product_id, movement.created_at, movement.id), '[]'::jsonb)
  into v_previous_movements
  from public.inventory_stock_movements as movement
  where movement.movement_date = date '2026-10-22'
    and movement.product_id = any(v_product_ids);

  select coalesce(jsonb_agg(to_jsonb(sale) order by sale.id), '[]'::jsonb)
  into v_buyer_sales_snapshot
  from public.buyer_sales as sale
  join public.products as product
    on lower(btrim(product.name)) = lower(btrim(sale.product))
  where sale.sale_date = date '2026-10-22'
    and product.id = any(v_product_ids);

  select coalesce(jsonb_agg(to_jsonb(sale) order by sale.id), '[]'::jsonb)
  into v_retail_sales_snapshot
  from public.retail_sales as sale
  join public.products as product
    on lower(btrim(product.name)) = lower(btrim(sale.product))
  where sale.sale_date = date '2026-10-22'
    and product.id = any(v_product_ids);

  insert into app_private.inventory_oct22_stock_repair_audit (
    stock_date,
    previous_counts,
    previous_movements,
    buyer_sales_snapshot,
    retail_sales_snapshot
  )
  values (
    date '2026-10-22',
    v_previous_counts,
    v_previous_movements,
    v_buyer_sales_snapshot,
    v_retail_sales_snapshot
  );

  delete from public.inventory_stock_movements
  where product_id = any(v_product_ids)
    and movement_date = date '2026-10-22'
    and movement_type <> 'sale';

  for v_product in
    select
      product.id as product_id,
      product.name as product_name,
      product.sales_unit,
      expected.quantity as corrected_quantity,
      expected.unit_cost as corrected_unit_cost
    from (values
      ('malli'::text, 1650::numeric, 36::numeric),
      ('pudina'::text, 2000::numeric, 8::numeric),
      ('karuvepillai'::text, 300::numeric, 35::numeric)
    ) as expected(name, quantity, unit_cost)
    join public.products as product
      on lower(btrim(product.name)) = expected.name
    order by expected.name
  loop
    select * into v_count
    from public.inventory_daily_counts
    where product_id = v_product.product_id
      and stock_date = date '2026-10-22'
    for update;

    select min(movement.created_at) - interval '1 microsecond'
    into v_count_event_time
    from public.inventory_stock_movements as movement
    where movement.product_id = v_product.product_id
      and movement.movement_date = date '2026-10-22'
      and movement.movement_type = 'sale';

    if v_count_event_time is null or v_count_event_time > v_count.created_at then
      v_count_event_time := v_count.created_at;
    end if;

    update public.inventory_daily_counts
    set counted_quantity = v_product.corrected_quantity,
        expected_quantity = 0,
        variance_quantity = v_product.corrected_quantity,
        quantity_unit = v_product.sales_unit,
        created_at = v_count_event_time
    where product_id = v_product.product_id
      and stock_date = date '2026-10-22';

    insert into public.inventory_stock_movements (
      product_id,
      movement_type,
      quantity_delta,
      cost_delta,
      movement_date,
      quantity_unit,
      reason,
      recorded_by,
      created_at
    )
    values (
      v_product.product_id,
      'count_adjustment',
      v_product.corrected_quantity,
      round(v_product.corrected_quantity * v_product.corrected_unit_cost, 2),
      date '2026-10-22',
      v_product.sales_unit,
      'Morning physical count verified for 22 Oct 2026',
      v_count.recorded_by,
      v_count_event_time
    );

    v_balance_quantity := v_product.corrected_quantity;
    v_balance_value := round(v_product.corrected_quantity * v_product.corrected_unit_cost, 2);

    for v_movement in
      select *
      from public.inventory_stock_movements
      where product_id = v_product.product_id
        and movement_date = date '2026-10-22'
        and movement_type = 'sale'
      order by created_at, id
      for update
    loop
      if v_movement.quantity_delta >= 0
        or v_balance_quantity <= 0
        or v_balance_quantity + v_movement.quantity_delta < 0 then
        raise exception 'Repair stopped: the verified count is insufficient for the recorded sales of %. No changes were committed.',
          v_product.product_name;
      end if;

      v_new_cost_delta := round(
        v_movement.quantity_delta * (v_balance_value / v_balance_quantity),
        2
      );

      update public.inventory_stock_movements
      set cost_delta = v_new_cost_delta
      where id = v_movement.id;

      v_balance_quantity := v_balance_quantity + v_movement.quantity_delta;
      v_balance_value := v_balance_value + v_new_cost_delta;
    end loop;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;

select
  product.name as product,
  daily_count.counted_quantity as morning_count,
  coalesce(sales.buyer_revenue, 0) as buyer_sales,
  coalesce(sales.retail_revenue, 0) as retail_sales,
  coalesce(sales.sale_cost, 0) as sale_cost,
  coalesce(sales.buyer_revenue, 0)
    + coalesce(sales.retail_revenue, 0)
    - coalesce(sales.sale_cost, 0) as final_profit,
  coalesce(balance.closing_quantity, 0) as closing_balance
from public.products as product
join public.inventory_daily_counts as daily_count
  on daily_count.product_id = product.id
  and daily_count.stock_date = date '2026-10-22'
left join lateral (
  select
    (
      select coalesce(sum(sale.mootais * sale.price_per_mootai), 0)
      from public.buyer_sales as sale
      where sale.sale_date = date '2026-10-22'
        and lower(btrim(sale.product)) = lower(btrim(product.name))
    ) as buyer_revenue,
    (
      select coalesce(sum(sale.mootais_sold * sale.price_per_mootai), 0)
      from public.retail_sales as sale
      where sale.sale_date = date '2026-10-22'
        and lower(btrim(sale.product)) = lower(btrim(product.name))
    ) as retail_revenue,
    (
      select coalesce(-sum(movement.cost_delta), 0)
      from public.inventory_stock_movements as movement
      where movement.product_id = product.id
        and movement.movement_date = date '2026-10-22'
        and movement.movement_type = 'sale'
    ) as sale_cost
) as sales on true
left join lateral (
  select coalesce(sum(movement.quantity_delta), 0) as closing_quantity
  from public.inventory_stock_movements as movement
  where movement.product_id = product.id
    and movement.movement_date = date '2026-10-22'
) as balance on true
where lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai')
order by product.name;
