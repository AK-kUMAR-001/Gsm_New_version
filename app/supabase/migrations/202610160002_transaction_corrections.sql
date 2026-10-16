begin;

do $$
declare
  v_table_name text;
  v_required_column record;
  v_column record;
begin
  if to_regclass('public.buyer_payments') is null then
    raise exception 'Transaction correction migration requires public.buyer_payments.';
  end if;

  for v_table_name in
    select table_name
    from (values ('buyer_payments'), ('payments')) as candidate(table_name)
    where to_regclass(format('public.%I', candidate.table_name)) is not null
  loop
    for v_required_column in
      select *
      from (values
        ('id', 'uuid'),
        ('buyer_id', 'uuid'),
        ('amount_paid', 'numeric'),
        ('paid_at', 'date'),
        ('notes', 'text')
      ) as required(column_name, expected_type)
    loop
      select data_type into v_column
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table_name
        and column_name = v_required_column.column_name;

      if not found then
        raise exception
          'Transaction correction migration requires public.%.% to have type %.',
          v_table_name,
          v_required_column.column_name,
          v_required_column.expected_type;
      end if;
      if v_column.data_type is distinct from v_required_column.expected_type then
        raise exception
          'Transaction correction migration requires public.%.% to have type %.',
          v_table_name,
          v_required_column.column_name,
          v_required_column.expected_type;
      end if;
    end loop;
  end loop;
end;
$$;

create table if not exists app_private.inventory_authorized_sale_mutations (
  transaction_id bigint not null,
  sale_table text not null check (sale_table in ('buyer_sales', 'retail_sales')),
  sale_id uuid not null,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  primary key (transaction_id, sale_table, sale_id, operation)
);

alter table app_private.inventory_authorized_sale_mutations enable row level security;
revoke all on app_private.inventory_authorized_sale_mutations from public, anon, authenticated;

create or replace function public.inventory_prevent_tracked_sale_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_authorized boolean := false;
  v_tracked boolean := false;
begin
  select exists (
    select 1
    from app_private.inventory_authorized_sale_mutations as sale_auth
    where sale_auth.transaction_id = txid_current()
      and sale_auth.sale_table = tg_table_name
      and sale_auth.sale_id = old.id
      and sale_auth.operation = tg_op
  ) into v_authorized;
  if v_authorized then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
    and to_regclass('public.inventory_authorized_sale_deletions') is not null then
    execute
      'select exists (
         select 1
         from public.inventory_authorized_sale_deletions
         where transaction_id = txid_current() and buyer_sale_id = $1
       )'
      into v_authorized
      using old.id;
    if v_authorized then
      return old;
    end if;
  end if;

  if to_regclass('public.inventory_product_settings') is not null
    and to_regclass('public.products') is not null then
    if tg_op = 'DELETE' then
      execute
        'select exists (
           select 1
           from public.products as product
           join public.inventory_product_settings as setting on setting.product_id = product.id
           where product.name = $1
         )'
        into v_tracked
        using old.product;
    else
      execute
        'select exists (
           select 1
           from public.products as product
           join public.inventory_product_settings as setting on setting.product_id = product.id
           where product.name = $1
         )'
        into v_tracked
        using old.product;
      if not v_tracked then
        execute
          'select exists (
             select 1
             from public.products as product
             join public.inventory_product_settings as setting on setting.product_id = product.id
             where product.name = $1
           )'
          into v_tracked
          using new.product;
      end if;
    end if;
  end if;

  if v_tracked then
    raise exception 'Stock-tracked sales require an authorized correction RPC.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app_private.inventory_assert_sale_stock_nonnegative(
  p_product_ids uuid[],
  p_stock_dates date[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
    from (
      select
        movement.product_id,
        movement.movement_date,
        movement.id,
        sum(movement.quantity_delta) over (
          partition by movement.product_id, movement.movement_date
          order by movement.id
          rows between unbounded preceding and current row
        ) as quantity_after_movement
      from public.inventory_stock_movements as movement
      where movement.product_id = any(p_product_ids)
        and movement.movement_date = any(p_stock_dates)
    ) as daily_balances
    where daily_balances.quantity_after_movement < 0
  ) then
    raise exception
      'Correction would make a stock balance negative. Adjust the sale date or quantity, or reconcile the affected stock day first.';
  end if;
end;
$$;

create or replace function app_private.inventory_correct_sale_movement(
  p_sale_table text,
  p_sale_id uuid,
  p_old_product text,
  p_old_quantity numeric,
  p_old_sale_date date,
  p_old_quantity_unit text,
  p_new_product text,
  p_new_quantity numeric,
  p_new_quantity_unit text,
  p_new_rate numeric,
  p_new_sale_date date
)
returns table (
  canonical_quantity numeric,
  canonical_rate numeric,
  canonical_unit text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_old_product_count integer;
  v_new_product_count integer;
  v_old_product_id uuid;
  v_old_sales_unit text;
  v_new_product public.products%rowtype;
  v_old_tracked boolean := false;
  v_new_tracked boolean := false;
  v_movement public.inventory_stock_movements%rowtype;
  v_has_movement boolean := false;
  v_today date := public.inventory_today_ist();
  v_old_quantity numeric(14, 3) := round(p_old_quantity, 3);
  v_new_quantity numeric(14, 3);
  v_new_rate numeric(14, 6);
  v_current_quantity numeric(14, 3);
  v_current_value numeric(14, 2);
  v_unit_cost numeric;
  v_new_cost_delta numeric(14, 2);
  v_product_ids uuid[];
  v_stock_dates date[];
begin
  if p_sale_table not in ('buyer_sales', 'retail_sales') then
    raise exception 'Unsupported sale table for stock correction.';
  end if;
  if p_sale_id is null then
    raise exception 'Choose a sale to correct.';
  end if;
  if p_new_product is null or nullif(trim(p_new_product), '') is null then
    raise exception 'Choose a valid product for the sale.';
  end if;
  if p_new_quantity is null or p_new_quantity <= 0 then
    raise exception 'Sale quantity must be greater than zero.';
  end if;
  if p_old_quantity is null or v_old_quantity <= 0 then
    raise exception 'The saved sale quantity is invalid; reconcile it before editing.';
  end if;
  if p_new_sale_date is null then
    raise exception 'Sale date is required.';
  end if;
  if p_new_sale_date > v_today then
    raise exception 'Sale date cannot be in the future.';
  end if;
  if p_new_quantity_unit is null or nullif(trim(p_new_quantity_unit), '') is null then
    raise exception 'Sale quantity unit is required.';
  end if;
  if p_new_rate is null then
    raise exception 'Sale rate is required.';
  end if;

  select count(*)
  into v_old_product_count
  from public.products as product
  where product.name = p_old_product;
  if v_old_product_count > 1 then
    raise exception 'The saved sale product matches multiple catalog entries; resolve duplicate products first.';
  elsif v_old_product_count = 1 then
    select product.id, product.sales_unit
    into v_old_product_id, v_old_sales_unit
    from public.products as product
    where product.name = p_old_product;
  end if;

  select count(*)
  into v_new_product_count
  from public.products as product
  where product.name = p_new_product;
  if v_new_product_count = 0 then
    raise exception 'Product not found in the catalog.';
  elsif v_new_product_count > 1 then
    raise exception 'Product name matches multiple catalog entries; resolve duplicate products first.';
  end if;
  select * into v_new_product
  from public.products as product
  where product.name = p_new_product;
  v_new_product_count := 1;

  perform 1
  from public.products as product
  where product.id = any(array_remove(array[v_old_product_id, v_new_product.id], null::uuid))
  order by product.id
  for update;
  perform 1
  from public.inventory_product_settings as setting
  where setting.product_id = any(array_remove(array[v_old_product_id, v_new_product.id], null::uuid))
  order by setting.product_id
  for update;

  if v_old_product_id is not null and not exists (
    select 1 from public.products
    where id = v_old_product_id and name = p_old_product
  ) then
    raise exception 'Saved sale product changed while the correction was being prepared; reload the sale and try again.';
  end if;
  select * into v_new_product
  from public.products as product
  where product.id = v_new_product.id
  for update;
  if v_new_product.name is distinct from p_new_product then
    raise exception 'Product changed while the correction was being prepared; reload the sale and try again.';
  end if;

  if p_new_quantity_unit = v_new_product.sales_unit then
    v_new_quantity := round(p_new_quantity, 3);
    v_new_rate := round(p_new_rate, 6);
  elsif p_new_quantity_unit = v_new_product.stock_entry_unit then
    v_new_quantity := round(p_new_quantity * v_new_product.stock_to_sales_factor, 3);
    v_new_rate := round(p_new_rate / v_new_product.stock_to_sales_factor, 6);
  else
    raise exception 'Choose a valid sale unit for this product.';
  end if;
  if v_new_quantity <= 0 then
    raise exception 'Sale quantity must be greater than zero after unit conversion.';
  end if;
  if p_sale_table = 'retail_sales' and v_new_rate <= 0 then
    raise exception 'Retail sale rate must be greater than zero after unit conversion.';
  elsif p_sale_table = 'buyer_sales' and v_new_rate < 0 then
    raise exception 'Buyer sale rate cannot be negative after unit conversion.';
  end if;
  if v_old_product_id is not null then
    select exists (
      select 1 from public.inventory_product_settings
      where product_id = v_old_product_id
    ) into v_old_tracked;
  end if;
  select exists (
    select 1 from public.inventory_product_settings
    where product_id = v_new_product.id
  ) into v_new_tracked;

  select * into v_movement
  from public.inventory_stock_movements as movement
  where movement.source_kind = p_sale_table
    and movement.source_id = p_sale_id
  for update;
  v_has_movement := found;

  if v_has_movement then
    if v_old_product_id is null
      or v_movement.movement_type <> 'sale'
      or v_movement.product_id <> v_old_product_id
      or v_movement.quantity_delta <> -v_old_quantity
      or v_movement.movement_date <> p_old_sale_date
      or v_movement.quantity_unit is distinct from v_old_sales_unit
      or v_movement.cost_delta > 0 then
      raise exception
        'The saved sale and its stock movement do not agree. Reconcile the linked movement before editing.';
    end if;
    if not v_old_tracked then
      raise exception
        'The sale has a linked stock movement but its product is not tracked; reconcile the inventory ledger first.';
    end if;
  elsif v_old_tracked and p_old_sale_date = v_today then
    raise exception
      'Today''s tracked sale has no linked stock movement. Reconcile the inventory ledger before editing.';
  end if;

  if v_new_tracked and p_new_sale_date = v_today
    and not exists (
      select 1 from public.inventory_daily_counts
      where product_id = v_new_product.id and stock_date = v_today
    ) then
    raise exception 'Record today''s physical stock count before correcting this tracked sale.';
  end if;

  if v_new_tracked and not v_has_movement and p_new_sale_date <> v_today then
    if v_old_product_id is distinct from v_new_product.id
      or v_old_quantity is distinct from v_new_quantity
      or p_old_sale_date is distinct from p_new_sale_date then
      raise exception
        'A historical sale without a linked stock movement cannot be assigned to tracked stock safely.';
    end if;
  end if;

  v_product_ids := array_remove(array[v_old_product_id, v_new_product.id], null::uuid);
  v_stock_dates := array_remove(array[p_old_sale_date, p_new_sale_date], null::date);

  if v_new_tracked then
    if v_has_movement and v_old_product_id = v_new_product.id then
      if v_new_quantity = v_old_quantity then
        v_new_cost_delta := v_movement.cost_delta;
      else
        v_unit_cost := -v_movement.cost_delta / v_old_quantity;
        v_new_cost_delta := round(-v_new_quantity * v_unit_cost, 2);
      end if;
    else
      select
        coalesce(sum(movement.quantity_delta), 0),
        coalesce(sum(movement.cost_delta), 0)
      into v_current_quantity, v_current_value
      from public.inventory_stock_movements as movement
      where movement.product_id = v_new_product.id
        and (
          movement.movement_date < p_new_sale_date
          or (
            movement.movement_date = p_new_sale_date
            and (not v_has_movement or movement.id < v_movement.id)
          )
        );

      if v_current_quantity <= 0 or v_current_value <= 0 then
        raise exception
          'Cannot change the sale to %: current tracked stock has no positive average unit cost.',
          v_new_product.name;
      end if;
      v_unit_cost := v_current_value / v_current_quantity;
      if v_unit_cost <= 0 then
        raise exception
          'Cannot change the sale to %: current average unit cost is not positive.',
          v_new_product.name;
      end if;
      v_new_cost_delta := round(-v_new_quantity * v_unit_cost, 2);
    end if;

    if v_has_movement then
      update public.inventory_stock_movements
      set product_id = v_new_product.id,
          quantity_delta = -v_new_quantity,
          cost_delta = v_new_cost_delta,
          movement_date = p_new_sale_date,
          quantity_unit = v_new_product.sales_unit
      where id = v_movement.id;
    elsif v_new_sale_date = v_today then
      insert into public.inventory_stock_movements (
        product_id,
        movement_type,
        quantity_delta,
        cost_delta,
        movement_date,
        quantity_unit,
        source_kind,
        source_id,
        reason,
        recorded_by
      )
      values (
        v_new_product.id,
        'sale',
        -v_new_quantity,
        v_new_cost_delta,
        p_new_sale_date,
        v_new_product.sales_unit,
        p_sale_table,
        p_sale_id,
        'Sale',
        auth.uid()
      );
      v_has_movement := true;
    end if;
  elsif v_has_movement then
    delete from public.inventory_stock_movements
    where id = v_movement.id;
    v_has_movement := false;
  end if;

  if v_has_movement then
    perform app_private.inventory_assert_sale_stock_nonnegative(v_product_ids, v_stock_dates);
  elsif v_old_tracked and v_old_product_id is not null then
    perform app_private.inventory_assert_sale_stock_nonnegative(
      array[v_old_product_id],
      array[p_old_sale_date]
    );
  end if;

  insert into app_private.inventory_authorized_sale_mutations (
    transaction_id, sale_table, sale_id, operation
  )
  values (txid_current(), p_sale_table, p_sale_id, 'UPDATE');
  canonical_quantity := v_new_quantity;
  canonical_rate := v_new_rate;
  canonical_unit := v_new_product.sales_unit;
  return next;
end;
$$;

create or replace function app_private.inventory_delete_sale_movement(
  p_sale_table text,
  p_sale_id uuid,
  p_old_product text,
  p_old_quantity numeric,
  p_old_sale_date date,
  p_old_quantity_unit text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_product_count integer;
  v_product_id uuid;
  v_product_sales_unit text;
  v_tracked boolean := false;
  v_movement public.inventory_stock_movements%rowtype;
  v_has_movement boolean := false;
  v_today date := public.inventory_today_ist();
begin
  if p_sale_table not in ('buyer_sales', 'retail_sales') then
    raise exception 'Unsupported sale table for stock correction.';
  end if;
  if p_sale_id is null then
    raise exception 'Choose a sale to delete.';
  end if;

  select count(*)
  into v_product_count
  from public.products as product
  where product.name = p_old_product;
  if v_product_count > 1 then
    raise exception 'The saved sale product matches multiple catalog entries; resolve duplicate products first.';
  elsif v_product_count = 1 then
    select product.id, product.sales_unit
    into v_product_id, v_product_sales_unit
    from public.products as product
    where product.name = p_old_product;
  end if;

  if v_product_id is not null then
    perform 1 from public.products where id = v_product_id for update;
    perform 1 from public.inventory_product_settings
    where product_id = v_product_id
    for update;
    select exists (
      select 1 from public.inventory_product_settings
      where product_id = v_product_id
    ) into v_tracked;
  end if;

  select * into v_movement
  from public.inventory_stock_movements as movement
  where movement.source_kind = p_sale_table
    and movement.source_id = p_sale_id
  for update;
  v_has_movement := found;

  if v_has_movement then
    if v_product_id is null
      or v_movement.movement_type <> 'sale'
      or v_movement.product_id <> v_product_id
      or v_movement.quantity_delta <> -round(p_old_quantity, 3)
      or v_movement.movement_date <> p_old_sale_date
      or v_movement.quantity_unit is distinct from v_product_sales_unit
      or v_movement.cost_delta > 0 then
      raise exception
        'The saved sale and its stock movement do not agree. Reconcile the linked movement before deleting.';
    end if;
    if not v_tracked then
      raise exception
        'The sale has a linked stock movement but its product is not tracked; reconcile the inventory ledger first.';
    end if;
    delete from public.inventory_stock_movements
    where id = v_movement.id;
    perform app_private.inventory_assert_sale_stock_nonnegative(
      array[v_product_id],
      array[p_old_sale_date]
    );
  elsif v_tracked and p_old_sale_date = v_today then
    raise exception
      'Today''s tracked sale has no linked stock movement. Reconcile the inventory ledger before deleting.';
  end if;

  insert into app_private.inventory_authorized_sale_mutations (
    transaction_id, sale_table, sale_id, operation
  )
  values (txid_current(), p_sale_table, p_sale_id, 'DELETE');
end;
$$;

create or replace function public.inventory_update_buyer_sale(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text
)
returns public.buyer_sales
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_sale public.buyer_sales%rowtype;
  v_existing_buyer_id uuid;
  v_quantity numeric;
  v_rate numeric;
  v_quantity_unit text;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can correct sales.';
  end if;
  if p_id is null then
    raise exception 'Choose a buyer sale to correct.';
  end if;
  if p_buyer_id is null then
    raise exception 'Choose a valid buyer for the sale.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Sale quantity must be greater than zero.';
  end if;
  if p_price_per_unit is null or p_price_per_unit < 0 then
    raise exception 'Buyer sale rate cannot be negative.';
  end if;
  if p_product is null or nullif(trim(p_product), '') is null then
    raise exception 'Choose a valid product for the sale.';
  end if;
  if p_quantity_unit is null or nullif(trim(p_quantity_unit), '') is null then
    raise exception 'Sale quantity unit is required.';
  end if;

  select buyer_id into v_existing_buyer_id
  from public.buyer_sales
  where id = p_id;
  if not found then
    raise exception 'Buyer sale not found.';
  end if;
  perform 1
  from public.buyers
  where id = any(array[p_buyer_id, v_existing_buyer_id])
  order by id
  for key share;
  if not exists (select 1 from public.buyers where id = p_buyer_id) then
    raise exception 'Buyer not found.';
  end if;
  select * into v_sale from public.buyer_sales where id = p_id for update;
  if not found then
    raise exception 'Buyer sale not found.';
  end if;
  if v_sale.buyer_id is distinct from v_existing_buyer_id then
    raise exception 'Buyer sale changed while the correction was being prepared; reload and try again.';
  end if;

  select canonical_quantity, canonical_rate, canonical_unit
  into v_quantity, v_rate, v_quantity_unit
  from app_private.inventory_correct_sale_movement(
    'buyer_sales',
    v_sale.id,
    v_sale.product,
    v_sale.mootais,
    v_sale.sale_date,
    v_sale.quantity_unit,
    p_product,
    p_quantity,
    p_quantity_unit,
    p_price_per_unit,
    p_sale_date
  );

  update public.buyer_sales
  set buyer_id = p_buyer_id,
      product = p_product,
      mootais = v_quantity,
      price_per_mootai = v_rate,
      sale_date = p_sale_date,
      notes = p_notes,
      quantity_unit = v_quantity_unit
  where id = p_id
  returning * into v_sale;

  delete from app_private.inventory_authorized_sale_mutations
  where transaction_id = txid_current()
    and sale_table = 'buyer_sales'
    and sale_id = p_id
    and operation = 'UPDATE';
  return v_sale;
end;
$$;

create or replace function public.inventory_update_retail_sale(
  p_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text
)
returns public.retail_sales
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_sale public.retail_sales%rowtype;
  v_quantity numeric;
  v_rate numeric;
  v_quantity_unit text;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can correct sales.';
  end if;
  if p_id is null then
    raise exception 'Choose a retail sale to correct.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Sale quantity must be greater than zero.';
  end if;
  if p_price_per_unit is null or p_price_per_unit <= 0 then
    raise exception 'Retail sale rate must be greater than zero.';
  end if;
  if p_product is null or nullif(trim(p_product), '') is null then
    raise exception 'Choose a valid product for the sale.';
  end if;
  if p_quantity_unit is null or nullif(trim(p_quantity_unit), '') is null then
    raise exception 'Sale quantity unit is required.';
  end if;

  select * into v_sale from public.retail_sales where id = p_id for update;
  if not found then
    raise exception 'Retail sale not found.';
  end if;

  select canonical_quantity, canonical_rate, canonical_unit
  into v_quantity, v_rate, v_quantity_unit
  from app_private.inventory_correct_sale_movement(
    'retail_sales',
    v_sale.id,
    v_sale.product,
    v_sale.mootais_sold,
    v_sale.sale_date,
    v_sale.quantity_unit,
    p_product,
    p_quantity,
    p_quantity_unit,
    p_price_per_unit,
    p_sale_date
  );

  update public.retail_sales
  set product = p_product,
      mootais_sold = v_quantity,
      price_per_mootai = v_rate,
      sale_date = p_sale_date,
      notes = p_notes,
      quantity_unit = v_quantity_unit
  where id = p_id
  returning * into v_sale;

  delete from app_private.inventory_authorized_sale_mutations
  where transaction_id = txid_current()
    and sale_table = 'retail_sales'
    and sale_id = p_id
    and operation = 'UPDATE';
  return v_sale;
end;
$$;

create or replace function public.inventory_delete_buyer_sale(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_sale public.buyer_sales%rowtype;
  v_buyer_id uuid;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can delete sales.';
  end if;
  if p_id is null then
    raise exception 'Choose a buyer sale to delete.';
  end if;

  select buyer_id into v_buyer_id
  from public.buyer_sales
  where id = p_id;
  if not found then
    raise exception 'Buyer sale not found.';
  end if;
  perform 1 from public.buyers where id = v_buyer_id for key share;
  if not found then
    raise exception 'Buyer not found for the sale.';
  end if;
  select * into v_sale from public.buyer_sales where id = p_id for update;
  if not found then
    raise exception 'Buyer sale not found.';
  end if;
  perform app_private.inventory_delete_sale_movement(
    'buyer_sales', v_sale.id, v_sale.product, v_sale.mootais,
    v_sale.sale_date, v_sale.quantity_unit
  );
  delete from public.buyer_sales where id = p_id;
  delete from app_private.inventory_authorized_sale_mutations
  where transaction_id = txid_current()
    and sale_table = 'buyer_sales'
    and sale_id = p_id
    and operation = 'DELETE';
end;
$$;

create or replace function public.inventory_delete_retail_sale(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_sale public.retail_sales%rowtype;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can delete sales.';
  end if;
  if p_id is null then
    raise exception 'Choose a retail sale to delete.';
  end if;

  select * into v_sale from public.retail_sales where id = p_id for update;
  if not found then
    raise exception 'Retail sale not found.';
  end if;
  perform app_private.inventory_delete_sale_movement(
    'retail_sales', v_sale.id, v_sale.product, v_sale.mootais_sold,
    v_sale.sale_date, v_sale.quantity_unit
  );
  delete from public.retail_sales where id = p_id;
  delete from app_private.inventory_authorized_sale_mutations
  where transaction_id = txid_current()
    and sale_table = 'retail_sales'
    and sale_id = p_id
    and operation = 'DELETE';
end;
$$;

create or replace function public.inventory_update_buyer_payment(
  p_id uuid,
  p_buyer_id uuid,
  p_amount_paid numeric,
  p_paid_at date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment jsonb;
  v_updated_payment jsonb;
  v_table_name text;
  v_rows bigint;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can correct buyer payments.';
  end if;
  if p_id is null then
    raise exception 'Choose a buyer payment to correct.';
  end if;
  if p_buyer_id is null then
    raise exception 'Choose a valid buyer for the payment.';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_paid_at is null then
    raise exception 'Payment date is required.';
  end if;

  perform 1 from public.buyers where id = p_buyer_id for key share;
  if not found then
    raise exception 'Buyer not found.';
  end if;
  if to_regclass('public.buyer_payments') is null then
    raise exception 'Primary payment table public.buyer_payments is missing.';
  end if;

  execute
    'select to_jsonb(payment) from public.buyer_payments as payment where payment.id = $1 for update'
    into v_payment
    using p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    v_table_name := 'buyer_payments';
  elsif to_regclass('public.payments') is not null then
    execute
      'select to_jsonb(payment) from public.payments as payment where payment.id = $1 for update'
      into v_payment
      using p_id;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_table_name := 'payments';
    end if;
  end if;
  if v_table_name is null then
    raise exception 'Buyer payment not found in buyer_payments or the legacy payments table.';
  end if;

  execute format(
    'update public.%I as payment
     set buyer_id = $2, amount_paid = $3, paid_at = $4, notes = $5
     where payment.id = $1
     returning to_jsonb(payment)',
    v_table_name
  )
  into v_updated_payment
  using p_id, p_buyer_id, p_amount_paid, p_paid_at, p_notes;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Buyer payment disappeared while it was being corrected.';
  end if;
  return v_updated_payment;
end;
$$;

create or replace function public.inventory_delete_buyer_payment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted_payment jsonb;
  v_table_name text;
  v_rows bigint;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can delete buyer payments.';
  end if;
  if p_id is null then
    raise exception 'Choose a buyer payment to delete.';
  end if;
  if to_regclass('public.buyer_payments') is null then
    raise exception 'Primary payment table public.buyer_payments is missing.';
  end if;

  execute
    'select to_jsonb(payment) from public.buyer_payments as payment where payment.id = $1 for update'
    into v_deleted_payment
    using p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    v_table_name := 'buyer_payments';
  elsif to_regclass('public.payments') is not null then
    execute
      'select to_jsonb(payment) from public.payments as payment where payment.id = $1 for update'
      into v_deleted_payment
      using p_id;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_table_name := 'payments';
    end if;
  end if;
  if v_table_name is null then
    raise exception 'Buyer payment not found in buyer_payments or the legacy payments table.';
  end if;

  execute format(
    'delete from public.%I as payment where payment.id = $1 returning to_jsonb(payment)',
    v_table_name
  )
  into v_deleted_payment
  using p_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Buyer payment disappeared while it was being deleted.';
  end if;
  return v_deleted_payment;
end;
$$;

revoke all on function public.inventory_update_buyer_sale(uuid, uuid, text, numeric, text, numeric, date, text) from public, anon;
revoke all on function public.inventory_update_retail_sale(uuid, text, numeric, text, numeric, date, text) from public, anon;
revoke all on function public.inventory_delete_buyer_sale(uuid) from public, anon;
revoke all on function public.inventory_delete_retail_sale(uuid) from public, anon;
revoke all on function public.inventory_update_buyer_payment(uuid, uuid, numeric, date, text) from public, anon;
revoke all on function public.inventory_delete_buyer_payment(uuid) from public, anon;
revoke all on function public.inventory_prevent_tracked_sale_mutation() from public, anon, authenticated;
grant execute on function public.inventory_update_buyer_sale(uuid, uuid, text, numeric, text, numeric, date, text) to authenticated;
grant execute on function public.inventory_update_retail_sale(uuid, text, numeric, text, numeric, date, text) to authenticated;
grant execute on function public.inventory_delete_buyer_sale(uuid) to authenticated;
grant execute on function public.inventory_delete_retail_sale(uuid) to authenticated;
grant execute on function public.inventory_update_buyer_payment(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.inventory_delete_buyer_payment(uuid) to authenticated;

revoke update, delete on public.buyer_sales, public.retail_sales, public.buyer_payments
  from public, anon, authenticated;
do $$
begin
  if to_regclass('public.payments') is not null then
    execute 'revoke update, delete on public.payments from public, anon, authenticated';
  end if;
end;
$$;

revoke all on function app_private.inventory_assert_sale_stock_nonnegative(uuid[], date[]) from public, anon, authenticated;
revoke all on function app_private.inventory_correct_sale_movement(text, uuid, text, numeric, date, text, text, numeric, text, numeric, date) from public, anon, authenticated;
revoke all on function app_private.inventory_delete_sale_movement(text, uuid, text, numeric, date, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
