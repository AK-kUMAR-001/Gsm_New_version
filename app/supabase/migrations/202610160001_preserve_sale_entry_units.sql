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

create or replace function public.inventory_record_buyer_sale(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_mootais numeric,
  p_price_per_mootai numeric,
  p_sale_date date,
  p_quantity_unit text,
  p_notes text default null
)
returns public.buyer_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.buyer_sales;
  v_sales_unit text;
  v_stock_unit text;
  v_factor numeric;
  v_quantity numeric;
  v_rate numeric;
begin
  if p_id is null then
    raise exception 'A sale request ID is required.';
  end if;
  if p_mootais is null or p_mootais <= 0 or p_price_per_mootai is null or p_price_per_mootai <= 0 then
    raise exception 'Sale quantity and rate must be greater than zero.';
  end if;

  select product.sales_unit, product.stock_entry_unit, product.stock_to_sales_factor
  into v_sales_unit, v_stock_unit, v_factor
  from public.products as product
  where lower(btrim(product.name)) = lower(btrim(p_product))
  limit 1;

  if not found then
    raise exception 'Product not found.';
  end if;

  if p_quantity_unit = v_sales_unit then
    v_factor := 1;
  elsif p_quantity_unit = v_stock_unit then
    null;
  else
    raise exception 'Unit "%" is not valid for product "%".', p_quantity_unit, p_product;
  end if;

  v_quantity := round(p_mootais * v_factor, 3);
  v_rate := round(p_price_per_mootai / v_factor, 6);

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_sale from public.buyer_sales where id = p_id;
  if found then
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from v_quantity
      or v_sale.price_per_mootai is distinct from v_rate
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.quantity_unit is distinct from p_quantity_unit
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.buyer_sales (
    id, buyer_id, product, mootais, price_per_mootai, sale_date, notes, quantity_unit
  )
  values (
    p_id, p_buyer_id, p_product, v_quantity, v_rate, p_sale_date, p_notes, p_quantity_unit
  )
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.buyer_sales where id = p_id;
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from v_quantity
      or v_sale.price_per_mootai is distinct from v_rate
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.quantity_unit is distinct from p_quantity_unit
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

create or replace function public.inventory_record_retail_sale(
  p_id uuid,
  p_product text,
  p_mootais_sold numeric,
  p_price_per_mootai numeric,
  p_sale_date date,
  p_quantity_unit text,
  p_notes text default null
)
returns public.retail_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.retail_sales;
  v_sales_unit text;
  v_stock_unit text;
  v_factor numeric;
  v_quantity numeric;
  v_rate numeric;
begin
  if p_id is null then
    raise exception 'A sale request ID is required.';
  end if;
  if p_mootais_sold is null or p_mootais_sold <= 0 or p_price_per_mootai is null or p_price_per_mootai <= 0 then
    raise exception 'Sale quantity and rate must be greater than zero.';
  end if;

  select product.sales_unit, product.stock_entry_unit, product.stock_to_sales_factor
  into v_sales_unit, v_stock_unit, v_factor
  from public.products as product
  where lower(btrim(product.name)) = lower(btrim(p_product))
  limit 1;

  if not found then
    raise exception 'Product not found.';
  end if;

  if p_quantity_unit = v_sales_unit then
    v_factor := 1;
  elsif p_quantity_unit = v_stock_unit then
    null;
  else
    raise exception 'Unit "%" is not valid for product "%".', p_quantity_unit, p_product;
  end if;

  v_quantity := round(p_mootais_sold * v_factor, 3);
  v_rate := round(p_price_per_mootai / v_factor, 6);

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_sale from public.retail_sales where id = p_id;
  if found then
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from v_quantity
      or v_sale.price_per_mootai is distinct from v_rate
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.quantity_unit is distinct from p_quantity_unit
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.retail_sales (
    id, product, mootais_sold, price_per_mootai, sale_date, notes, quantity_unit
  )
  values (
    p_id, p_product, v_quantity, v_rate, p_sale_date, p_notes, p_quantity_unit
  )
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.retail_sales where id = p_id;
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from v_quantity
      or v_sale.price_per_mootai is distinct from v_rate
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.quantity_unit is distinct from p_quantity_unit
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

commit;
