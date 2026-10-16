begin;

lock table public.products, public.buyer_sales, public.retail_sales,
  public.inventory_stock_movements
in share row exclusive mode;

do $$
begin
  if not exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150003_sale_input_unit_conversion'
  ) then
    raise exception 'Sale movement reconciliation stopped: migration 003 is not recorded as applied.';
  end if;
  if exists (
    select 1 from app_private.applied_data_migrations
    where migration_name = '202610150005_reconcile_sale_movement_units'
  ) then
    raise exception 'Sale movement reconciliation has already been applied.';
  end if;
end;
$$;

create temporary table sale_movement_unit_repair_candidates on commit drop as
select
  'buyer_sales'::text as source_kind,
  sale.id as source_id,
  product.id as product_id,
  lower(btrim(product.name)) as product_name,
  product.sales_unit,
  product.stock_entry_unit,
  product.stock_to_sales_factor,
  sale.quantity_unit,
  sale.mootais as quantity,
  sale.price_per_mootai as rate,
  case
    when sale.quantity_unit = product.sales_unit
      then sale.mootais / product.stock_to_sales_factor
    when sale.quantity_unit = product.stock_entry_unit then sale.mootais
    else null
  end as original_input_quantity,
  case
    when sale.quantity_unit = product.sales_unit then sale.mootais
    when sale.quantity_unit = product.stock_entry_unit
      then sale.mootais * product.stock_to_sales_factor
    else null
  end as canonical_quantity
from public.buyer_sales as sale
join public.products as product
  on lower(btrim(product.name)) = lower(btrim(sale.product))
where sale.sale_date = date '2026-10-15'
  and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai')
union all
select
  'retail_sales'::text as source_kind,
  sale.id as source_id,
  product.id as product_id,
  lower(btrim(product.name)) as product_name,
  product.sales_unit,
  product.stock_entry_unit,
  product.stock_to_sales_factor,
  sale.quantity_unit,
  sale.mootais_sold as quantity,
  sale.price_per_mootai as rate,
  case
    when sale.quantity_unit = product.sales_unit
      then sale.mootais_sold / product.stock_to_sales_factor
    when sale.quantity_unit = product.stock_entry_unit then sale.mootais_sold
    else null
  end as original_input_quantity,
  case
    when sale.quantity_unit = product.sales_unit then sale.mootais_sold
    when sale.quantity_unit = product.stock_entry_unit
      then sale.mootais_sold * product.stock_to_sales_factor
    else null
  end as canonical_quantity
from public.retail_sales as sale
join public.products as product
  on lower(btrim(product.name)) = lower(btrim(sale.product))
where sale.sale_date = date '2026-10-15'
  and lower(btrim(product.name)) in ('malli', 'pudina', 'karuvepillai');

do $$
declare
  v_product record;
  v_sale_count bigint;
  v_quantity numeric;
  v_revenue numeric;
  v_movement_count bigint;
  v_invalid_movement_count bigint;
begin
  for v_product in
    select *
    from (values
      ('malli'::text, 50::numeric, 'Kattu'::text, 'Mootai'::text, 4::bigint, 4975::numeric, 9371::numeric),
      ('pudina'::text, 200::numeric, 'Kattu'::text, 'Mootai'::text, 4::bigint, 27200::numeric, 1088::numeric),
      ('karuvepillai'::text, 1::numeric, 'Kg'::text, 'Kg'::text, 3::bigint, 33.5::numeric, 1299::numeric)
    ) as expected(product_name, factor, sales_unit, stock_unit, sale_count, quantity, revenue)
  loop
    if not exists (
      select 1
      from public.products as product
      where lower(btrim(product.name)) = v_product.product_name
        and product.sales_unit = v_product.sales_unit
        and product.stock_entry_unit = v_product.stock_unit
        and product.stock_to_sales_factor = v_product.factor
    ) or (
      select count(*) from public.products
      where lower(btrim(name)) = v_product.product_name
    ) <> 1 then
      raise exception 'Sale movement reconciliation stopped: unit settings for % do not match the verified conversion.', v_product.product_name;
    end if;

    select
      count(*),
      coalesce(sum(candidate.canonical_quantity), 0),
      round(coalesce(sum(candidate.quantity * candidate.rate), 0), 0)
    into v_sale_count, v_quantity, v_revenue
    from sale_movement_unit_repair_candidates as candidate
    where candidate.product_name = v_product.product_name;

    if v_sale_count <> v_product.sale_count
      or v_quantity <> v_product.quantity
      or v_revenue <> v_product.revenue
      or exists (
        select 1
        from sale_movement_unit_repair_candidates as candidate
        where candidate.product_name = v_product.product_name
          and (
            candidate.canonical_quantity is null
            or candidate.original_input_quantity is null
            or candidate.source_kind <> 'buyer_sales'
          )
      ) then
      raise exception
        'Sale movement reconciliation stopped for %: expected % sale rows, canonical quantity %, and revenue ₹%; found rows %, quantity %, and revenue ₹%. No data was changed.',
        v_product.product_name,
        v_product.sale_count,
        v_product.quantity,
        v_product.revenue,
        v_sale_count,
        v_quantity,
        v_revenue;
    end if;

    select
      count(movement.id),
      count(*) filter (
        where movement.id is null
          or movement.movement_type <> 'sale'
          or movement.movement_date <> date '2026-10-15'
          or movement.quantity_delta >= 0
          or (
            abs(movement.quantity_delta + candidate.original_input_quantity) > 0.001
            and abs(movement.quantity_delta + candidate.canonical_quantity) > 0.001
          )
      )
    into v_movement_count, v_invalid_movement_count
    from sale_movement_unit_repair_candidates as candidate
    left join public.inventory_stock_movements as movement
      on movement.source_kind = candidate.source_kind
      and movement.source_id = candidate.source_id
      and movement.product_id = candidate.product_id
    where candidate.product_name = v_product.product_name;

    if v_movement_count <> v_product.sale_count
      or v_invalid_movement_count <> 0 then
      raise exception
        'Sale movement reconciliation stopped for %: expected % linked movements with raw or canonical quantities; found % movements, % invalid. No data was changed.',
        v_product.product_name,
        v_product.sale_count,
        v_movement_count,
        v_invalid_movement_count;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_updated_count bigint;
begin
  update public.inventory_stock_movements as movement
  set quantity_delta = -candidate.canonical_quantity,
      quantity_unit = candidate.sales_unit
  from sale_movement_unit_repair_candidates as candidate
  where movement.source_kind = candidate.source_kind
    and movement.source_id = candidate.source_id
    and movement.product_id = candidate.product_id
    and movement.movement_type = 'sale'
    and movement.movement_date = date '2026-10-15';

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 11 then
    raise exception 'Sale movement reconciliation stopped: expected to update 11 linked sale movements, updated %.', v_updated_count;
  end if;
end;
$$;

insert into app_private.applied_data_migrations(migration_name)
values ('202610150005_reconcile_sale_movement_units');

notify pgrst, 'reload schema';
commit;
