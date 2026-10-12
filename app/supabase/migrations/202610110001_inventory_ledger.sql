create table if not exists public.inventory_product_settings (
  product_id uuid primary key references public.products(id) on delete restrict,
  enabled_at timestamptz not null default now(),
  enabled_by uuid not null default auth.uid()
);

create table if not exists public.inventory_stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (
    movement_type in ('opening', 'receipt', 'sale', 'spoilage', 'correction', 'count_adjustment')
  ),
  quantity_delta numeric(14, 3) not null check (quantity_delta <> 0),
  cost_delta numeric(14, 2) not null,
  movement_date date not null,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  source_kind text,
  source_id uuid,
  reason text not null check (length(trim(reason)) > 0),
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (source_kind, source_id)
);

create index if not exists inventory_stock_movements_product_date_idx
  on public.inventory_stock_movements (product_id, movement_date, id);

create table if not exists public.inventory_daily_counts (
  product_id uuid not null references public.products(id) on delete restrict,
  stock_date date not null,
  counted_quantity numeric(14, 3) not null check (counted_quantity >= 0),
  expected_quantity numeric(14, 3) not null check (expected_quantity >= 0),
  variance_quantity numeric(14, 3) not null,
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (product_id, stock_date)
);

alter table public.inventory_product_settings enable row level security;
alter table public.inventory_stock_movements enable row level security;
alter table public.inventory_daily_counts enable row level security;

drop policy if exists "Authenticated users can read inventory settings"
  on public.inventory_product_settings;
create policy "Authenticated users can read inventory settings"
  on public.inventory_product_settings for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can read stock movements"
  on public.inventory_stock_movements;
create policy "Authenticated users can read stock movements"
  on public.inventory_stock_movements for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can read stock counts"
  on public.inventory_daily_counts;
create policy "Authenticated users can read stock counts"
  on public.inventory_daily_counts for select to authenticated
  using (auth.uid() is not null);

revoke all on public.inventory_product_settings from anon, authenticated;
revoke all on public.inventory_stock_movements from anon, authenticated;
revoke all on public.inventory_daily_counts from anon, authenticated;
grant select on public.inventory_product_settings to authenticated;
grant select on public.inventory_stock_movements to authenticated;
grant select on public.inventory_daily_counts to authenticated;

create or replace view public.inventory_stock_summary
with (security_invoker = true)
as
select
  setting.product_id,
  coalesce(sum(movement.quantity_delta), 0)::numeric(14, 3) as quantity_on_hand,
  coalesce(sum(movement.cost_delta), 0)::numeric(14, 2) as inventory_value,
  case
    when coalesce(sum(movement.quantity_delta), 0) > 0
      then round(sum(movement.cost_delta) / sum(movement.quantity_delta), 2)
    else null
  end as average_unit_cost,
  setting.enabled_at
from public.inventory_product_settings as setting
left join public.inventory_stock_movements as movement
  on movement.product_id = setting.product_id
group by setting.product_id, setting.enabled_at;

grant select on public.inventory_stock_summary to authenticated;

create or replace function public.inventory_today_ist()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.inventory_start_tracking(
  p_product_id uuid,
  p_opening_quantity numeric,
  p_estimated_unit_cost numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to start stock tracking.';
  end if;
  if p_opening_quantity is null or p_opening_quantity < 0 then
    raise exception 'Opening stock cannot be negative.';
  end if;
  if p_opening_quantity > 0 and (p_estimated_unit_cost is null or p_estimated_unit_cost <= 0) then
    raise exception 'Enter an estimated cost per Mootai greater than zero.';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found.';
  end if;

  insert into public.inventory_product_settings (product_id, enabled_by)
  values (p_product_id, auth.uid());

  if p_opening_quantity > 0 then
    insert into public.inventory_stock_movements (
      product_id, movement_type, quantity_delta, cost_delta, movement_date, reason, recorded_by
    )
    values (
      p_product_id,
      'opening',
      p_opening_quantity,
      round(p_opening_quantity * p_estimated_unit_cost, 2),
      public.inventory_today_ist(),
      'Opening stock; estimated unit cost',
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.inventory_record_morning_count(
  p_product_id uuid,
  p_counted_quantity numeric,
  p_surplus_unit_cost numeric default null
)
returns public.inventory_daily_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected numeric(14, 3);
  v_value numeric(14, 2);
  v_variance numeric(14, 3);
  v_unit_cost numeric(14, 2);
  v_count public.inventory_daily_counts;
  v_today date := public.inventory_today_ist();
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a stock count.';
  end if;
  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'Counted stock cannot be negative.';
  end if;

  perform 1 from public.inventory_product_settings
    where product_id = p_product_id for update;
  if not found then
    raise exception 'Start stock tracking with an opening quantity first.';
  end if;

  if exists (
    select 1 from public.inventory_daily_counts
    where product_id = p_product_id and stock_date = v_today
  ) then
    raise exception 'A morning count is already recorded for this product today.';
  end if;

  select
    coalesce(sum(quantity_delta), 0),
    coalesce(sum(cost_delta), 0)
  into v_expected, v_value
  from public.inventory_stock_movements
  where product_id = p_product_id;

  v_variance := p_counted_quantity - v_expected;
  if v_variance > 0 then
    if v_expected > 0 then
      v_unit_cost := round(v_value / v_expected, 2);
    elsif p_surplus_unit_cost is not null and p_surplus_unit_cost > 0 then
      v_unit_cost := round(p_surplus_unit_cost, 2);
    else
      raise exception 'Enter an estimated cost per Mootai for the additional counted stock.';
    end if;

    insert into public.inventory_stock_movements (
      product_id, movement_type, quantity_delta, cost_delta, movement_date, reason, recorded_by
    )
    values (
      p_product_id, 'count_adjustment', v_variance,
      round(v_variance * v_unit_cost, 2), v_today,
      'Morning physical count surplus', auth.uid()
    );
  elsif v_variance < 0 then
    if v_expected <= 0 then
      raise exception 'Count variance cannot reduce an empty stock balance.';
    end if;
    v_unit_cost := round(v_value / v_expected, 2);
    insert into public.inventory_stock_movements (
      product_id, movement_type, quantity_delta, cost_delta, movement_date, reason, recorded_by
    )
    values (
      p_product_id, 'count_adjustment', v_variance,
      round(v_variance * v_unit_cost, 2), v_today,
      'Morning physical count shortage', auth.uid()
    );
  end if;

  insert into public.inventory_daily_counts (
    product_id, stock_date, counted_quantity, expected_quantity, variance_quantity, recorded_by
  )
  values (p_product_id, v_today, p_counted_quantity, v_expected, v_variance, auth.uid())
  returning * into v_count;

  return v_count;
end;
$$;

create or replace function public.inventory_record_receipt(
  p_product_id uuid,
  p_supplier_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_notes text default null,
  p_request_id uuid default null
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.inventory_stock_movements;
  v_reason text := coalesce(nullif(trim(p_notes), ''), 'Supplier stock receipt');
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a supplier receipt.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Received quantity must be greater than zero.';
  end if;
  if p_unit_cost is null or p_unit_cost <= 0 then
    raise exception 'Purchase cost per Mootai must be greater than zero.';
  end if;
  if p_request_id is null then
    raise exception 'A stock receipt request ID is required.';
  end if;

  perform 1 from public.inventory_product_settings
    where product_id = p_product_id for update;
  if not found then
    raise exception 'Start stock tracking for this product before recording a receipt.';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Select a valid supplier.';
  end if;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    supplier_id, source_kind, source_id, reason, recorded_by
  )
  values (
    p_product_id, 'receipt', p_quantity,
    round(p_quantity * p_unit_cost, 2), public.inventory_today_ist(),
    p_supplier_id, 'receipt', p_request_id, v_reason, auth.uid()
  )
  on conflict (source_kind, source_id) do nothing
  returning * into v_movement;

  if not found then
    select * into v_movement
    from public.inventory_stock_movements
    where source_kind = 'receipt' and source_id = p_request_id;
    if v_movement.product_id is distinct from p_product_id
      or v_movement.supplier_id is distinct from p_supplier_id
      or v_movement.quantity_delta is distinct from round(p_quantity, 3)
      or v_movement.cost_delta is distinct from round(p_quantity * p_unit_cost, 2)
      or v_movement.reason is distinct from v_reason then
      raise exception 'Receipt request ID was already used for different stock details.';
    end if;
  end if;

  return v_movement;
end;
$$;

create or replace function public.inventory_record_adjustment(
  p_product_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_request_id uuid default null
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity numeric(14, 3);
  v_value numeric(14, 2);
  v_unit_cost numeric(14, 2);
  v_movement public.inventory_stock_movements;
  v_delta numeric(14, 3);
  v_reason text := trim(p_reason);
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a stock adjustment.';
  end if;
  if p_movement_type not in ('spoilage', 'correction') then
    raise exception 'Choose damaged stock or correction.';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Adjustment quantity cannot be zero.';
  end if;
  if p_request_id is null then
    raise exception 'A stock adjustment request ID is required.';
  end if;
  if p_movement_type = 'spoilage' and p_quantity_delta >= 0 then
    raise exception 'Spoilage quantity must be entered as a positive amount to remove.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Enter a reason for the stock adjustment.';
  end if;
  v_delta := p_quantity_delta;

  perform 1 from public.inventory_product_settings
    where product_id = p_product_id for update;
  if not found then
    raise exception 'Start stock tracking for this product first.';
  end if;

  select * into v_movement
  from public.inventory_stock_movements
  where source_kind = 'adjustment' and source_id = p_request_id;
  if found then
    if v_movement.product_id is distinct from p_product_id
      or v_movement.movement_type is distinct from p_movement_type
      or v_movement.quantity_delta is distinct from v_delta
      or v_movement.reason is distinct from v_reason
      or (v_delta > 0 and p_unit_cost is not null
        and v_movement.cost_delta is distinct from round(v_delta * p_unit_cost, 2)) then
      raise exception 'Adjustment request ID was already used for different stock details.';
    end if;
    return v_movement;
  end if;

  select coalesce(sum(quantity_delta), 0), coalesce(sum(cost_delta), 0)
  into v_quantity, v_value
  from public.inventory_stock_movements
  where product_id = p_product_id;

  if v_quantity + v_delta < 0 then
    raise exception 'Adjustment exceeds available stock.';
  end if;
  if v_delta > 0 then
    v_unit_cost := coalesce(p_unit_cost, case when v_quantity > 0 then v_value / v_quantity end);
    if v_unit_cost is null or v_unit_cost <= 0 then
      raise exception 'Enter an estimated cost per Mootai for additional stock.';
    end if;
  else
    if v_quantity <= 0 then
      raise exception 'There is no stock available to remove.';
    end if;
    v_unit_cost := v_value / v_quantity;
  end if;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    source_kind, source_id, reason, recorded_by
  )
  values (
    p_product_id, p_movement_type, v_delta,
    round(v_delta * v_unit_cost, 2), public.inventory_today_ist(),
    'adjustment', p_request_id, v_reason, auth.uid()
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

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
  v_price numeric(14, 2);
  v_quantity_on_hand numeric(14, 3);
  v_inventory_value numeric(14, 2);
  v_unit_cost numeric(14, 2);
  v_today date := public.inventory_today_ist();
  v_sale_kind text := tg_table_name;
begin
  if new.sale_date is distinct from v_today then
    raise exception 'Sales must be dated today in the India time zone.';
  end if;

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

create or replace function public.inventory_prevent_tracked_sale_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_name text := case when tg_op = 'DELETE' then old.product else old.product end;
begin
  if exists (
    select 1
    from public.products as product
    join public.inventory_product_settings as setting on setting.product_id = product.id
    where product.name = v_product_name
  ) then
    raise exception 'Stock-tracked sales cannot be edited or deleted because transaction corrections are not yet available.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
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

drop trigger if exists buyer_sales_inventory_mutation on public.buyer_sales;
create trigger buyer_sales_inventory_mutation
  before update or delete on public.buyer_sales
  for each row execute function public.inventory_prevent_tracked_sale_mutation();

drop trigger if exists retail_sales_inventory_mutation on public.retail_sales;
create trigger retail_sales_inventory_mutation
  before update or delete on public.retail_sales
  for each row execute function public.inventory_prevent_tracked_sale_mutation();

create or replace function public.inventory_record_buyer_sale(
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
begin
  if p_id is null then
    raise exception 'A sale request ID is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_sale from public.buyer_sales where id = p_id;
  if found then
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from p_mootais
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.buyer_sales (id, buyer_id, product, mootais, price_per_mootai, sale_date, notes)
  values (p_id, p_buyer_id, p_product, p_mootais, p_price_per_mootai, p_sale_date, p_notes)
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.buyer_sales where id = p_id;
    if v_sale.buyer_id is distinct from p_buyer_id
      or v_sale.product is distinct from p_product
      or v_sale.mootais is distinct from p_mootais
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
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
  p_notes text default null
)
returns public.retail_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.retail_sales;
begin
  if p_id is null then
    raise exception 'A sale request ID is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_sale from public.retail_sales where id = p_id;
  if found then
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from p_mootais_sold
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
    return v_sale;
  end if;

  insert into public.retail_sales (id, product, mootais_sold, price_per_mootai, sale_date, notes)
  values (p_id, p_product, p_mootais_sold, p_price_per_mootai, p_sale_date, p_notes)
  on conflict (id) do nothing
  returning * into v_sale;

  if not found then
    select * into v_sale from public.retail_sales where id = p_id;
    if v_sale.product is distinct from p_product
      or v_sale.mootais_sold is distinct from p_mootais_sold
      or v_sale.price_per_mootai is distinct from p_price_per_mootai
      or v_sale.sale_date is distinct from p_sale_date
      or v_sale.notes is distinct from p_notes then
      raise exception 'Sale request ID was already used for different sale details.';
    end if;
  end if;

  return v_sale;
end;
$$;

revoke all on function public.inventory_today_ist() from public, anon;
revoke all on function public.inventory_start_tracking(uuid, numeric, numeric) from public, anon;
revoke all on function public.inventory_record_morning_count(uuid, numeric, numeric) from public, anon;
revoke all on function public.inventory_record_receipt(uuid, uuid, numeric, numeric, text, uuid) from public, anon;
revoke all on function public.inventory_record_adjustment(uuid, text, numeric, text, numeric, uuid) from public, anon;
revoke all on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text) from public, anon;
revoke all on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text) from public, anon;
grant execute on function public.inventory_today_ist() to authenticated;
grant execute on function public.inventory_start_tracking(uuid, numeric, numeric) to authenticated;
grant execute on function public.inventory_record_morning_count(uuid, numeric, numeric) to authenticated;
grant execute on function public.inventory_record_receipt(uuid, uuid, numeric, numeric, text, uuid) to authenticated;
grant execute on function public.inventory_record_adjustment(uuid, text, numeric, text, numeric, uuid) to authenticated;
grant execute on function public.inventory_record_buyer_sale(uuid, uuid, text, numeric, numeric, date, text) to authenticated;
grant execute on function public.inventory_record_retail_sale(uuid, text, numeric, numeric, date, text) to authenticated;
