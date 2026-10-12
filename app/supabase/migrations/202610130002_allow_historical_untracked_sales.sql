create or replace function public.inventory_apply_sale_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_product_matches integer;
  v_quantity numeric(14, 3);
  v_quantity_on_hand numeric(14, 3);
  v_inventory_value numeric(14, 2);
  v_unit_cost numeric(14, 2);
  v_today date := public.inventory_today_ist();
  v_sale_kind text := tg_table_name;
begin
  select count(*) into v_product_matches
  from public.products
  where name = new.product;

  if v_product_matches > 1 and exists (
    select 1
    from public.products as product
    join public.inventory_product_settings as setting on setting.product_id = product.id
    where product.name = new.product
  ) then
    raise exception 'Product name matches multiple catalog entries; resolve duplicate names before tracking stock.';
  end if;

  select id into v_product_id from public.products where name = new.product;
  if v_product_id is null then
    return new;
  end if;

  perform 1 from public.inventory_product_settings
    where product_id = v_product_id for update;
  if not found then
    return new;
  end if;

  if new.sale_date is distinct from v_today then
    raise exception 'Sales must be dated today in the India time zone.';
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
    raise exception 'Insufficient stock: % Mootais available, % requested.',
      v_quantity_on_hand, v_quantity;
  end if;
  v_unit_cost := case when v_quantity_on_hand > 0 then v_inventory_value / v_quantity_on_hand else 0 end;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    source_kind, source_id, reason, recorded_by
  )
  values (
    v_product_id, 'sale', -v_quantity,
    round(-v_quantity * v_unit_cost, 2), v_today,
    v_sale_kind, new.id, 'Sale', auth.uid()
  );

  return new;
end;
$$;
