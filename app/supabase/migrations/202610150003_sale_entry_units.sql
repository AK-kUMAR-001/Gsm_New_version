drop function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text);
drop function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text);

create function public.inventory_record_buyer_sale(
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
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.buyer_sales (id, buyer_id, product, mootais, price_per_mootai, sale_date, notes)
  values (p_id, p_buyer_id, p_product, v_quantity, v_rate, p_sale_date, p_notes)
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.buyer_sales where id = p_id;
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from v_quantity
      or v_sale.price_per_mootai is distinct from v_rate
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

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
  v_sales_unit text;
begin
  select product.sales_unit
  into v_sales_unit
  from public.products as product
  where lower(btrim(product.name)) = lower(btrim(p_product))
  limit 1;

  if not found then
    raise exception 'Product not found.';
  end if;

  return public.inventory_record_buyer_sale(
    p_id, p_buyer_id, p_product, p_mootais, p_price_per_mootai, p_sale_date, v_sales_unit, p_notes
  );
end;
$$;

create function public.inventory_record_retail_sale(
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
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.retail_sales (id, product, mootais_sold, price_per_mootai, sale_date, notes)
  values (p_id, p_product, v_quantity, v_rate, p_sale_date, p_notes)
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.retail_sales where id = p_id;
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from v_quantity
      or v_sale.price_per_mootai is distinct from v_rate
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

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
  v_sales_unit text;
begin
  select product.sales_unit
  into v_sales_unit
  from public.products as product
  where lower(btrim(product.name)) = lower(btrim(p_product))
  limit 1;

  if not found then
    raise exception 'Product not found.';
  end if;

  return public.inventory_record_retail_sale(
    p_id, p_product, p_mootais_sold, p_price_per_mootai, p_sale_date, v_sales_unit, p_notes
  );
end;
$$;

revoke all on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text, text) from public, anon;
revoke all on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text, text) from public, anon;
revoke all on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text) from public, anon;
revoke all on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text) from public, anon;
grant execute on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text, text) to authenticated;
grant execute on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text, text) to authenticated;
grant execute on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text) to authenticated;
grant execute on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text) to authenticated;
