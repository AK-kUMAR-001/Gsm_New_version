begin;

lock table public.products, public.buyer_sales, public.retail_sales,
  public.inventory_stock_movements
in share row exclusive mode;

create table if not exists app_private.applied_data_migrations (
  migration_name text primary key,
  applied_at timestamptz not null default now()
);

do $$
declare
  v_malli_id uuid;
  v_pudina_id uuid;
  v_karuvepillai_id uuid;
  v_target_sale_count integer;
  v_raw_rate_count integer;
  v_converted_rate_count integer;
begin
  if exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150003_sale_input_unit_conversion'
  ) then
    raise exception 'Sale input unit migration has already been applied.';
  end if;

  select id into v_malli_id from public.products where lower(btrim(name)) = 'malli';
  select id into v_pudina_id from public.products where lower(btrim(name)) = 'pudina';
  select id into v_karuvepillai_id from public.products where lower(btrim(name)) = 'karuvepillai';

  if v_malli_id is null or v_pudina_id is null or v_karuvepillai_id is null
    or (select count(*) from public.products where lower(btrim(name)) in ('malli', 'pudina', 'karuvepillai')) <> 3
    or not exists (select 1 from public.products where id = v_malli_id and sales_unit = 'Kattu' and stock_entry_unit = 'Mootai' and stock_to_sales_factor = 50)
    or not exists (select 1 from public.products where id = v_pudina_id and sales_unit = 'Kattu' and stock_entry_unit = 'Mootai' and stock_to_sales_factor = 200)
    or not exists (select 1 from public.products where id = v_karuvepillai_id and sales_unit = 'Kg' and stock_entry_unit = 'Kg' and stock_to_sales_factor = 1) then
    raise exception 'Sale input unit migration stopped: product unit settings do not match the verified conversions.';
  end if;

  select count(*) into v_target_sale_count
  from (
    select id
    from public.buyer_sales
    where sale_date = date '2026-10-15'
      and lower(btrim(product)) in ('malli', 'pudina', 'karuvepillai')
    union all
    select id
    from public.retail_sales
    where sale_date = date '2026-10-15'
      and lower(btrim(product)) in ('malli', 'pudina', 'karuvepillai')
  ) as sale;

  if v_target_sale_count = 0 then
    raise exception 'Sale input unit migration stopped: no 15 Oct 2026 sales were found.';
  end if;

  select count(*) into v_raw_rate_count
  from (
    select product, price_per_mootai as rate
    from public.buyer_sales
    where sale_date = date '2026-10-15'
    union all
    select product, price_per_mootai as rate
    from public.retail_sales
    where sale_date = date '2026-10-15'
  ) as sale
  where lower(btrim(sale.product)) in ('malli', 'pudina')
    and sale.rate >= 5;

  select count(*) into v_converted_rate_count
  from (
    select product, price_per_mootai as rate
    from public.buyer_sales
    where sale_date = date '2026-10-15'
    union all
    select product, price_per_mootai as rate
    from public.retail_sales
    where sale_date = date '2026-10-15'
  ) as sale
  where lower(btrim(sale.product)) in ('malli', 'pudina')
    and sale.rate > 0
    and sale.rate < 5;

  if v_raw_rate_count > 0 and v_converted_rate_count > 0 then
    raise exception 'Sale input unit migration stopped: 15 Oct Malli/Pudina sales mix original and converted rates. Review those rows before continuing.';
  end if;

  if v_raw_rate_count > 0 and (exists (
    select 1
    from public.buyer_sales as sale
    join public.products as product on lower(btrim(product.name)) = lower(btrim(sale.product))
    join public.inventory_product_settings as setting on setting.product_id = product.id
    where sale.sale_date = date '2026-10-15'
      and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai')
      and not exists (
        select 1 from public.inventory_stock_movements as movement
        where movement.source_kind = 'buyer_sales'
          and movement.source_id = sale.id
          and movement.movement_type = 'sale'
      )
  ) or exists (
    select 1
    from public.retail_sales as sale
    join public.products as product on lower(btrim(product.name)) = lower(btrim(sale.product))
    join public.inventory_product_settings as setting on setting.product_id = product.id
    where sale.sale_date = date '2026-10-15'
      and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai')
      and not exists (
        select 1 from public.inventory_stock_movements as movement
        where movement.source_kind = 'retail_sales'
          and movement.source_id = sale.id
          and movement.movement_type = 'sale'
      )
  )) then
    raise exception 'Sale input unit migration stopped: tracked 15 Oct sales are missing stock-ledger movements.';
  end if;
end;
$$;

create temporary table sale_unit_correction on commit drop as
select
  'buyer_sales'::text as source_kind,
  sale.id as source_id,
  product.id as product_id,
  product.stock_to_sales_factor as factor
from public.buyer_sales as sale
join public.products as product on lower(btrim(product.name)) = lower(btrim(sale.product))
where sale.sale_date = date '2026-10-15'
  and lower(btrim(product.name)) in ('malli', 'pudina')
  and sale.price_per_mootai >= 5
union all
select
  'retail_sales'::text as source_kind,
  sale.id as source_id,
  product.id as product_id,
  product.stock_to_sales_factor as factor
from public.retail_sales as sale
join public.products as product on lower(btrim(product.name)) = lower(btrim(sale.product))
where sale.sale_date = date '2026-10-15'
  and lower(btrim(product.name)) in ('malli', 'pudina')
  and sale.price_per_mootai >= 5;

create temporary table sale_unit_revenue_before on commit drop as
select
  (select coalesce(sum(mootais * price_per_mootai), 0)
   from public.buyer_sales where sale_date = date '2026-10-15')
  + (select coalesce(sum(mootais_sold * price_per_mootai), 0)
     from public.retail_sales where sale_date = date '2026-10-15') as total_revenue;

alter table public.buyer_sales disable trigger buyer_sales_inventory_mutation;
alter table public.retail_sales disable trigger retail_sales_inventory_mutation;

update public.buyer_sales as sale
set mootais = round(sale.mootais * correction.factor, 3),
    price_per_mootai = round(sale.price_per_mootai / correction.factor, 6),
    quantity_unit = product.sales_unit
from sale_unit_correction as correction
join public.products as product on product.id = correction.product_id
where correction.source_kind = 'buyer_sales'
  and correction.source_id = sale.id;

update public.retail_sales as sale
set mootais_sold = round(sale.mootais_sold * correction.factor, 3),
    price_per_mootai = round(sale.price_per_mootai / correction.factor, 6),
    quantity_unit = product.sales_unit
from sale_unit_correction as correction
join public.products as product on product.id = correction.product_id
where correction.source_kind = 'retail_sales'
  and correction.source_id = sale.id;

alter table public.buyer_sales enable trigger buyer_sales_inventory_mutation;
alter table public.retail_sales enable trigger retail_sales_inventory_mutation;

update public.inventory_stock_movements as movement
set quantity_delta = round(movement.quantity_delta * correction.factor, 3),
    quantity_unit = product.sales_unit
from sale_unit_correction as correction
join public.products as product on product.id = correction.product_id
where movement.source_kind = correction.source_kind
  and movement.source_id = correction.source_id
  and movement.movement_type = 'sale';

do $$
declare
  v_revenue_before numeric;
  v_revenue_after numeric;
begin
  select total_revenue into v_revenue_before from sale_unit_revenue_before;
  select
    (select coalesce(sum(mootais * price_per_mootai), 0)
     from public.buyer_sales where sale_date = date '2026-10-15')
    + (select coalesce(sum(mootais_sold * price_per_mootai), 0)
       from public.retail_sales where sale_date = date '2026-10-15')
  into v_revenue_after;

  if v_revenue_before <> v_revenue_after then
    raise exception 'Sale input unit migration stopped: 15 Oct revenue changed from % to %.', v_revenue_before, v_revenue_after;
  end if;
end;
$$;

create or replace function public.inventory_record_buyer_sale_with_unit(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text default null
)
returns public.buyer_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product public.products;
  v_quantity numeric;
  v_rate numeric;
begin
  select * into v_product from public.products where name = p_product;
  if not found then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;
  if (select count(*) from public.products where name = p_product) <> 1 then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;

  if p_quantity_unit = v_product.sales_unit then
    v_quantity := p_quantity;
    v_rate := p_price_per_unit;
  elsif p_quantity_unit = v_product.stock_entry_unit then
    v_quantity := p_quantity * v_product.stock_to_sales_factor;
    v_rate := p_price_per_unit / v_product.stock_to_sales_factor;
  else
    raise exception 'Choose a valid sale unit for this product.';
  end if;

  return public.inventory_record_buyer_sale(
    p_id, p_buyer_id, p_product, v_quantity, v_rate, p_sale_date, p_notes
  );
end;
$$;

create or replace function public.inventory_record_retail_sale_with_unit(
  p_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text default null
)
returns public.retail_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product public.products;
  v_quantity numeric;
  v_rate numeric;
begin
  select * into v_product from public.products where name = p_product;
  if not found then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;
  if (select count(*) from public.products where name = p_product) <> 1 then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;

  if p_quantity_unit = v_product.sales_unit then
    v_quantity := p_quantity;
    v_rate := p_price_per_unit;
  elsif p_quantity_unit = v_product.stock_entry_unit then
    v_quantity := p_quantity * v_product.stock_to_sales_factor;
    v_rate := p_price_per_unit / v_product.stock_to_sales_factor;
  else
    raise exception 'Choose a valid sale unit for this product.';
  end if;

  return public.inventory_record_retail_sale(
    p_id, p_product, v_quantity, v_rate, p_sale_date, p_notes
  );
end;
$$;

revoke all on function public.inventory_record_buyer_sale_with_unit(uuid, uuid, text, numeric, text, numeric, date, text) from public, anon;
revoke all on function public.inventory_record_retail_sale_with_unit(uuid, text, numeric, text, numeric, date, text) from public, anon;
grant execute on function public.inventory_record_buyer_sale_with_unit(uuid, uuid, text, numeric, text, numeric, date, text) to authenticated;
grant execute on function public.inventory_record_retail_sale_with_unit(uuid, text, numeric, text, numeric, date, text) to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202610150003_sale_input_unit_conversion');

notify pgrst, 'reload schema';
commit;
