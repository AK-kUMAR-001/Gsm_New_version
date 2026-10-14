create or replace function public.inventory_apply_sale_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_product_matches integer;
  v_product_active boolean;
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

  if v_product_matches = 0 then
    raise exception 'Product not found in the catalog. Add the product and enter its opening stock before recording a sale.';
  end if;
  if v_product_matches > 1 then
    raise exception 'Product name matches multiple catalog entries; resolve duplicate names before recording a sale.';
  end if;

  select id, active into v_product_id, v_product_active
  from public.products
  where name = new.product
  for update;

  if not found then
    raise exception 'Product not found in the catalog.';
  end if;
  if not v_product_active then
    raise exception 'This product is inactive. Activate it before recording a sale.';
  end if;

  if new.sale_date is distinct from v_today then
    raise exception 'Sales must be dated today in the India time zone.';
  end if;

  if tg_table_name = 'buyer_sales' then
    v_quantity := new.mootais;
  else
    v_quantity := new.mootais_sold;
  end if;
  if v_quantity is null or v_quantity <= 0 then
    raise exception 'Sale quantity must be greater than zero.';
  end if;

  perform 1 from public.inventory_product_settings
  where product_id = v_product_id
  for update;
  if not found then
    raise exception 'Stock tracking has not started. Enter opening stock before recording a sale.';
  end if;

  if not exists (
    select 1 from public.inventory_daily_counts
    where product_id = v_product_id and stock_date = v_today
  ) then
    raise exception 'Record today''s physical stock count before selling this product.';
  end if;

  select coalesce(sum(quantity_delta), 0), coalesce(sum(cost_delta), 0)
  into v_quantity_on_hand, v_inventory_value
  from public.inventory_stock_movements
  where product_id = v_product_id;

  if v_quantity > v_quantity_on_hand then
    raise exception 'Insufficient stock: % Mootais available, % requested.',
      v_quantity_on_hand, v_quantity;
  end if;

  v_unit_cost := case
    when v_quantity_on_hand > 0 then v_inventory_value / v_quantity_on_hand
    else 0
  end;

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

drop trigger if exists buyer_sales_inventory_insert on public.buyer_sales;
create trigger buyer_sales_inventory_insert
  before insert on public.buyer_sales
  for each row execute function public.inventory_apply_sale_movement();

drop trigger if exists retail_sales_inventory_insert on public.retail_sales;
create trigger retail_sales_inventory_insert
  before insert on public.retail_sales
  for each row execute function public.inventory_apply_sale_movement();

create or replace function public.inventory_delete_or_archive_product(p_product_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_stock_history boolean;
begin
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found or you do not have permission to manage it.';
  end if;

  select
    exists (
      select 1 from public.inventory_product_settings
      where product_id = p_product_id
    )
    or exists (
      select 1 from public.inventory_stock_movements
      where product_id = p_product_id
    )
    or exists (
      select 1 from public.inventory_daily_counts
      where product_id = p_product_id
    )
  into v_has_stock_history;

  if v_has_stock_history then
    update public.products set active = false where id = p_product_id;
    return 'archived';
  end if;

  delete from public.products where id = p_product_id;
  return 'deleted';
end;
$$;

revoke all on function public.inventory_delete_or_archive_product(uuid) from public, anon;
grant execute on function public.inventory_delete_or_archive_product(uuid) to authenticated;
