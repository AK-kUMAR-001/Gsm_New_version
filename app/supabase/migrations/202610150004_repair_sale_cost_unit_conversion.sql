begin;

lock table public.products, public.buyer_sales, public.retail_sales,
  public.inventory_stock_movements
in share row exclusive mode;

do $$
begin
  if not exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150001_product_units_and_historical_conversion'
  ) then
    raise exception 'Sale cost repair stopped: product-unit migration 001 is not recorded as applied.';
  end if;
  if not exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150003_sale_input_unit_conversion'
  ) then
    raise exception 'Sale cost repair stopped: sale-unit migration 003 is not recorded as applied.';
  end if;
  if exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150004_repair_sale_cost_unit_conversion'
  ) then
    raise exception 'Sale cost repair has already been applied.';
  end if;
end;
$$;

create temporary table sale_cost_unit_repair_candidates on commit drop as
select
  'buyer_sales'::text as source_kind,
  sale.id as source_id,
  product.id as product_id,
  product.name as product_name,
  product.stock_to_sales_factor as factor,
  sale.mootais as quantity,
  sale.price_per_mootai as rate
from public.buyer_sales as sale
join public.products as product
  on lower(btrim(product.name)) = lower(btrim(sale.product))
join app_private.applied_data_migrations as applied
  on applied.migration_name = '202610150003_sale_input_unit_conversion'
where sale.sale_date = date '2026-10-15'
  and sale.created_at <= applied.applied_at
  and lower(btrim(product.name)) in ('malli', 'pudina')
  and sale.quantity_unit = product.sales_unit
  and sale.price_per_mootai > 0
  and sale.price_per_mootai < 5
union all
select
  'retail_sales'::text as source_kind,
  sale.id as source_id,
  product.id as product_id,
  product.name as product_name,
  product.stock_to_sales_factor as factor,
  sale.mootais_sold as quantity,
  sale.price_per_mootai as rate
from public.retail_sales as sale
join public.products as product
  on lower(btrim(product.name)) = lower(btrim(sale.product))
join app_private.applied_data_migrations as applied
  on applied.migration_name = '202610150003_sale_input_unit_conversion'
where sale.sale_date = date '2026-10-15'
  and sale.created_at <= applied.applied_at
  and lower(btrim(product.name)) in ('malli', 'pudina')
  and sale.quantity_unit = product.sales_unit
  and sale.price_per_mootai > 0
  and sale.price_per_mootai < 5;

do $$
declare
  v_product record;
  v_sale_count bigint;
  v_quantity numeric;
  v_revenue numeric;
  v_movement_count bigint;
  v_movement_quantity numeric;
  v_movement_cost numeric;
begin
  for v_product in
    select *
    from (values
      ('malli'::text, 50::numeric, 4975::numeric, 9371::numeric, 258700::numeric),
      ('pudina'::text, 200::numeric, 27200::numeric, 1088::numeric, 217600::numeric)
    ) as expected(product_name, factor, quantity, revenue, inflated_cost)
  loop
    select
      count(*),
      coalesce(sum(candidate.quantity), 0),
      round(coalesce(sum(candidate.quantity * candidate.rate), 0), 0)
    into v_sale_count, v_quantity, v_revenue
    from sale_cost_unit_repair_candidates as candidate
    where lower(btrim(candidate.product_name)) = v_product.product_name
      and candidate.factor = v_product.factor;

    select
      count(movement.id),
      coalesce(sum(-movement.quantity_delta), 0),
      round(coalesce(sum(-movement.cost_delta), 0), 0)
    into v_movement_count, v_movement_quantity, v_movement_cost
    from sale_cost_unit_repair_candidates as candidate
    left join public.inventory_stock_movements as movement
      on movement.source_kind = candidate.source_kind
      and movement.source_id = candidate.source_id
      and movement.product_id = candidate.product_id
      and movement.movement_type = 'sale'
      and movement.movement_date = date '2026-10-15'
    where lower(btrim(candidate.product_name)) = v_product.product_name;

    if v_sale_count = 0
      or v_quantity <> v_product.quantity
      or v_revenue <> v_product.revenue
      or v_movement_count <> v_sale_count
      or v_movement_quantity <> v_product.quantity
      or v_movement_cost <> v_product.inflated_cost then
      raise exception
        'Sale cost repair stopped for %: expected quantity %, revenue ₹%, linked quantity %, and inflated stock cost ₹%; found sales %, quantity %, revenue ₹%, linked movements %, linked quantity %, and stock cost ₹%. No data was changed.',
        v_product.product_name,
        v_product.quantity,
        v_product.revenue,
        v_product.quantity,
        v_product.inflated_cost,
        v_sale_count,
        v_quantity,
        v_revenue,
        v_movement_count,
        v_movement_quantity,
        v_movement_cost;
    end if;
  end loop;

  if exists (
    select 1
    from public.inventory_stock_movements as movement
    join sale_cost_unit_repair_candidates as candidate
      on candidate.source_kind = movement.source_kind
      and candidate.source_id = movement.source_id
      and candidate.product_id = movement.product_id
    where movement.movement_type = 'sale'
      and movement.cost_delta > 0
  ) then
    raise exception 'Sale cost repair stopped: a matched sale movement has a positive cost delta.';
  end if;
end;
$$;

update public.inventory_stock_movements as movement
set cost_delta = round(movement.cost_delta / candidate.factor, 2)
from sale_cost_unit_repair_candidates as candidate
where movement.source_kind = candidate.source_kind
  and movement.source_id = candidate.source_id
  and movement.product_id = candidate.product_id
  and movement.movement_type = 'sale'
  and movement.movement_date = date '2026-10-15';

insert into app_private.applied_data_migrations(migration_name)
values ('202610150004_repair_sale_cost_unit_conversion');

notify pgrst, 'reload schema';
commit;
