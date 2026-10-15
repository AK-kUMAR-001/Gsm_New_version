begin;

lock table public.products, public.buyer_sales, public.retail_sales,
  public.inventory_stock_movements, public.inventory_daily_counts,
  public.inventory_product_settings
in share row exclusive mode;

create table if not exists app_private.applied_data_migrations (
  migration_name text primary key,
  applied_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150001_product_units_and_historical_conversion'
  ) then
    raise exception 'Product unit migration has already been applied.';
  end if;

  if exists (
    select 1
    from public.inventory_stock_movements as movement
    join public.products as product on product.id = movement.product_id
    where lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai')
      and movement.movement_date < date '2026-10-13'
  ) then
    raise exception
      'Product unit migration stopped: tracked Malli/Pudina/Karuvepillai stock exists before 13 Oct 2026 and needs a separate opening-balance review.';
  end if;
  if exists (
    select 1
    from public.inventory_daily_counts as count_row
    join public.products as product on product.id = count_row.product_id
    where lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai')
      and count_row.stock_date < date '2026-10-13'
  ) then
    raise exception
      'Product unit migration stopped: tracked Malli/Pudina/Karuvepillai counts exist before 13 Oct 2026 and need a separate opening-balance review.';
  end if;
end;
$$;

alter table public.products
  add column sales_unit text not null default 'Mootai',
  add column stock_entry_unit text not null default 'Mootai',
  add column stock_to_sales_factor numeric(14, 6) not null default 1,
  add constraint products_units_valid check (
    length(trim(sales_unit)) between 1 and 32
    and length(trim(stock_entry_unit)) between 1 and 32
    and stock_to_sales_factor > 0
  );

alter table public.buyer_sales
  add column quantity_unit text not null default 'Mootai',
  alter column price_per_mootai type numeric(14, 6);

alter table public.retail_sales
  add column quantity_unit text not null default 'Mootai',
  alter column price_per_mootai type numeric(14, 6);

alter table public.inventory_stock_movements
  add column quantity_unit text not null default 'Mootai';

alter table public.inventory_daily_counts
  add column quantity_unit text not null default 'Mootai';

update public.products
set sales_unit = 'Kattu',
    stock_entry_unit = 'Mootai',
    stock_to_sales_factor = 200
where lower(btrim(name)) = 'pudina';

update public.products
set sales_unit = 'Kattu',
    stock_entry_unit = 'Mootai',
    stock_to_sales_factor = 50
where lower(btrim(name)) = 'malli';

update public.products
set sales_unit = 'Kg',
    stock_entry_unit = 'Kg',
    stock_to_sales_factor = 1
where lower(btrim(name)) = 'karuvepillai';

do $$
begin
  if (select count(*) from public.products where lower(btrim(name)) = 'pudina') <> 1
    or (select count(*) from public.products where lower(btrim(name)) = 'malli') <> 1
    or (select count(*) from public.products where lower(btrim(name)) = 'karuvepillai') <> 1 then
    raise exception 'Product unit migration stopped: expected exactly one Pudina, Malli, and Karuvepillai product.';
  end if;
end;
$$;

create temporary table unit_migration_revenue_before on commit drop as
select
  (select coalesce(sum(mootais * price_per_mootai), 0)
   from public.buyer_sales where sale_date >= date '2026-10-13')
  + (select coalesce(sum(mootais_sold * price_per_mootai), 0)
     from public.retail_sales where sale_date >= date '2026-10-13') as total_revenue;

-- The ledger quantities are converted in the same transaction below; suppress
-- the normal immutable-sale guard only for this one-time historical conversion.
alter table public.buyer_sales disable trigger buyer_sales_inventory_mutation;
alter table public.retail_sales disable trigger retail_sales_inventory_mutation;

update public.buyer_sales as sale
set mootais = sale.mootais * product.stock_to_sales_factor,
    price_per_mootai = sale.price_per_mootai / product.stock_to_sales_factor,
    quantity_unit = product.sales_unit
from public.products as product
where lower(btrim(product.name)) = lower(btrim(sale.product))
  and sale.sale_date >= date '2026-10-13'
  and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai');

update public.retail_sales as sale
set mootais_sold = sale.mootais_sold * product.stock_to_sales_factor,
    price_per_mootai = sale.price_per_mootai / product.stock_to_sales_factor,
    quantity_unit = product.sales_unit
from public.products as product
where lower(btrim(product.name)) = lower(btrim(sale.product))
  and sale.sale_date >= date '2026-10-13'
  and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai');

alter table public.buyer_sales enable trigger buyer_sales_inventory_mutation;
alter table public.retail_sales enable trigger retail_sales_inventory_mutation;

update public.inventory_stock_movements as movement
set quantity_delta = movement.quantity_delta * product.stock_to_sales_factor,
    quantity_unit = product.sales_unit
from public.products as product
where product.id = movement.product_id
  and movement.movement_date >= date '2026-10-13'
  and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai');

update public.inventory_daily_counts as count_row
set counted_quantity = count_row.counted_quantity * product.stock_to_sales_factor,
    expected_quantity = count_row.expected_quantity * product.stock_to_sales_factor,
    variance_quantity = count_row.variance_quantity * product.stock_to_sales_factor,
    quantity_unit = product.sales_unit
from public.products as product
where product.id = count_row.product_id
  and count_row.stock_date >= date '2026-10-13'
  and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai');

update public.inventory_product_settings as setting
set low_stock_threshold = setting.low_stock_threshold * product.stock_to_sales_factor
from public.products as product
where product.id = setting.product_id
  and lower(btrim(product.name)) in ('malli', 'pudina');

do $$
declare
  v_revenue_before numeric;
  v_revenue_after numeric;
begin
  select total_revenue into v_revenue_before from unit_migration_revenue_before;
  select
    (select coalesce(sum(mootais * price_per_mootai), 0)
     from public.buyer_sales where sale_date >= date '2026-10-13')
    + (select coalesce(sum(mootais_sold * price_per_mootai), 0)
       from public.retail_sales where sale_date >= date '2026-10-13')
  into v_revenue_after;

  if v_revenue_before <> v_revenue_after then
    raise exception 'Product unit migration stopped: revenue changed from % to %.', v_revenue_before, v_revenue_after;
  end if;
end;
$$;

create or replace function public.inventory_set_quantity_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit text;
begin
  select sales_unit into v_unit
  from public.products
  where id = new.product_id;

  if v_unit is null then
    raise exception 'Product unit configuration was not found.';
  end if;
  new.quantity_unit := v_unit;
  return new;
end;
$$;

create trigger inventory_stock_movements_set_unit
before insert on public.inventory_stock_movements
for each row execute function public.inventory_set_quantity_unit();

create trigger inventory_daily_counts_set_unit
before insert on public.inventory_daily_counts
for each row execute function public.inventory_set_quantity_unit();

create or replace function public.inventory_prevent_product_unit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.sales_unit, new.stock_entry_unit, new.stock_to_sales_factor)
    is distinct from (old.sales_unit, old.stock_entry_unit, old.stock_to_sales_factor)
    and (
      exists (select 1 from public.buyer_sales where product = old.name)
      or exists (select 1 from public.retail_sales where product = old.name)
      or exists (select 1 from public.inventory_stock_movements where product_id = old.id)
      or exists (select 1 from public.inventory_daily_counts where product_id = old.id)
    ) then
    raise exception 'Product units cannot be changed after transactions exist; contact support to preserve historical balances.';
  end if;
  return new;
end;
$$;

create trigger products_prevent_unit_change
before update on public.products
for each row execute function public.inventory_prevent_product_unit_change();

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
  where product_id = v_product_id;

  if v_quantity > v_quantity_on_hand then
    raise exception 'Insufficient stock: % % available, % requested.',
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

drop function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text);
create function public.inventory_record_buyer_sale(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_mootais numeric,
  p_price_per_mootai numeric,
  p_sale_date date,
  p_notes text default null
)
returns public.buyer_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.buyer_sales;
  v_unit text;
  v_product_matches integer;
begin
  if p_id is null then
    raise exception 'A sale request ID is required.';
  end if;
  select count(*) into v_product_matches from public.products where name = p_product;
  if v_product_matches <> 1 then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;
  select sales_unit into v_unit from public.products where name = p_product;
  if v_unit is null then
    raise exception 'Product unit configuration was not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_sale from public.buyer_sales where id = p_id;
  if found then
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from p_mootais
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes
      or v_sale.quantity_unit is distinct from v_unit then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.buyer_sales
    (id, buyer_id, product, mootais, price_per_mootai, sale_date, notes, quantity_unit)
  values
    (p_id, p_buyer_id, p_product, p_mootais, p_price_per_mootai, p_sale_date, p_notes, v_unit)
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.buyer_sales where id = p_id;
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from p_mootais
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes
      or v_sale.quantity_unit is distinct from v_unit then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

drop function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text);
create function public.inventory_record_retail_sale(
  p_id uuid,
  p_product text,
  p_mootais_sold numeric,
  p_price_per_mootai numeric,
  p_sale_date date,
  p_notes text default null
)
returns public.retail_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.retail_sales;
  v_unit text;
  v_product_matches integer;
begin
  if p_id is null then
    raise exception 'A sale request ID is required.';
  end if;
  select count(*) into v_product_matches from public.products where name = p_product;
  if v_product_matches <> 1 then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;
  select sales_unit into v_unit from public.products where name = p_product;
  if v_unit is null then
    raise exception 'Product unit configuration was not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_sale from public.retail_sales where id = p_id;
  if found then
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from p_mootais_sold
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes
      or v_sale.quantity_unit is distinct from v_unit then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.retail_sales
    (id, product, mootais_sold, price_per_mootai, sale_date, notes, quantity_unit)
  values
    (p_id, p_product, p_mootais_sold, p_price_per_mootai, p_sale_date, p_notes, v_unit)
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.retail_sales where id = p_id;
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from p_mootais_sold
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes
      or v_sale.quantity_unit is distinct from v_unit then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

revoke all on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text) from public, anon;
revoke all on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text) from public, anon;
grant execute on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text) to authenticated;
grant execute on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text) to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202610150001_product_units_and_historical_conversion');

notify pgrst, 'reload schema';
commit;
