begin;

create table if not exists public.retail_daily_sessions (
  sale_date date primary key,
  status text not null check (status in ('active', 'finished')),
  started_at timestamptz not null default now(),
  started_by uuid not null default auth.uid(),
  finished_at timestamptz,
  check ((status = 'active' and finished_at is null) or (status = 'finished' and finished_at is not null))
);

create table if not exists public.retail_daily_prices (
  sale_date date not null references public.retail_daily_sessions(sale_date) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_unit text not null,
  price_per_unit numeric(14, 2) not null check (price_per_unit > 0),
  primary key (sale_date, product_id)
);

alter table public.retail_daily_sessions enable row level security;
alter table public.retail_daily_prices enable row level security;

drop policy if exists "App owner can read retail day sessions" on public.retail_daily_sessions;
create policy "App owner can read retail day sessions"
  on public.retail_daily_sessions for select to authenticated
  using (public.is_gsm_traders_owner());

drop policy if exists "App owner can read retail day prices" on public.retail_daily_prices;
create policy "App owner can read retail day prices"
  on public.retail_daily_prices for select to authenticated
  using (public.is_gsm_traders_owner());

revoke all on public.retail_daily_sessions, public.retail_daily_prices from anon, authenticated;
grant select on public.retail_daily_sessions, public.retail_daily_prices to authenticated;

create or replace function public.inventory_start_retail_day(p_prices jsonb)
returns public.retail_daily_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.inventory_today_ist();
  v_expected_count integer;
  v_entry_count integer;
  v_session public.retail_daily_sessions;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can start retail sales.';
  end if;
  if jsonb_typeof(p_prices) is distinct from 'array' then
    raise exception 'Retail prices must be provided for each active tracked product.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('retail-day:' || v_today::text, 0));
  perform setting.product_id
  from public.inventory_product_settings as setting
  join public.products as product on product.id = setting.product_id
  where product.active
  order by setting.product_id
  for update of setting;

  select count(*) into v_expected_count
  from public.inventory_product_settings as setting
  join public.products as product on product.id = setting.product_id
  where product.active;

  if v_expected_count = 0 then
    raise exception 'No active stock-tracked products are available for retail.';
  end if;

  select count(*) into v_entry_count
  from jsonb_to_recordset(p_prices) as entry(product_id uuid, quantity_unit text, price_per_unit numeric);

  if v_entry_count <> v_expected_count then
    raise exception 'Enter one retail price for every active stock-tracked product.';
  end if;
  if exists (
    select entry.product_id
    from jsonb_to_recordset(p_prices) as entry(product_id uuid, quantity_unit text, price_per_unit numeric)
    group by entry.product_id
    having count(*) > 1
  ) then
    raise exception 'A retail price was entered more than once for a product.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_prices) as entry(product_id uuid, quantity_unit text, price_per_unit numeric)
    left join public.inventory_product_settings as setting on setting.product_id = entry.product_id
    left join public.products as product on product.id = setting.product_id
    where product.id is null
      or not product.active
      or entry.quantity_unit is distinct from product.sales_unit
      or entry.price_per_unit is null
      or entry.price_per_unit <= 0
  ) then
    raise exception 'Each retail price must use the product sales unit and be greater than zero.';
  end if;
  if exists (
    select 1
    from public.inventory_product_settings as setting
    join public.products as product on product.id = setting.product_id
    left join jsonb_to_recordset(p_prices) as entry(product_id uuid, quantity_unit text, price_per_unit numeric)
      on entry.product_id = product.id
    where product.active and entry.product_id is null
  ) then
    raise exception 'Enter a retail price for every active stock-tracked product.';
  end if;
  if exists (
    select 1
    from public.inventory_product_settings as setting
    join public.products as product on product.id = setting.product_id
    left join public.inventory_daily_counts as count_row
      on count_row.product_id = product.id and count_row.stock_date = v_today
    where product.active and count_row.product_id is null
  ) then
    raise exception 'Record today''s physical stock count for all active tracked products before starting retail.';
  end if;
  if exists (
    select 1
    from public.retail_daily_sessions
    where sale_date = v_today
  ) then
    raise exception 'Retail sales have already been started or finished for today.';
  end if;

  insert into public.retail_daily_sessions (sale_date, status, started_by)
  values (v_today, 'active', auth.uid())
  returning * into v_session;

  insert into public.retail_daily_prices (sale_date, product_id, quantity_unit, price_per_unit)
  select v_today, entry.product_id, entry.quantity_unit, entry.price_per_unit
  from jsonb_to_recordset(p_prices) as entry(product_id uuid, quantity_unit text, price_per_unit numeric);

  return v_session;
end;
$$;

create or replace function public.inventory_finish_retail_day()
returns public.retail_daily_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.inventory_today_ist();
  v_session public.retail_daily_sessions;
  v_price record;
  v_quantity numeric(14, 3);
  v_sale_id uuid;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can finish retail sales.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('retail-day:' || v_today::text, 0));
  select * into v_session
  from public.retail_daily_sessions
  where sale_date = v_today
  for update;

  if not found then
    raise exception 'Start retail sales and set today''s prices before finishing.';
  end if;
  if v_session.status = 'finished' then
    return v_session;
  end if;

  for v_price in
    select price.product_id, price.quantity_unit, price.price_per_unit, product.name
    from public.retail_daily_prices as price
    join public.products as product on product.id = price.product_id
    where price.sale_date = v_today
    order by price.product_id
  loop
    perform 1
    from public.inventory_product_settings as setting
    where setting.product_id = v_price.product_id
    for update;
    if not found then
      raise exception 'Stock tracking was removed for product "%"; retail sales were not finished.', v_price.name;
    end if;
    if not exists (
      select 1 from public.inventory_daily_counts
      where product_id = v_price.product_id and stock_date = v_today
    ) then
      raise exception 'Today''s physical count is missing for "%"; retail sales were not finished.', v_price.name;
    end if;

    select coalesce(sum(movement.quantity_delta), 0)
    into v_quantity
    from public.inventory_stock_movements as movement
    where movement.product_id = v_price.product_id
      and movement.movement_date = v_today;

    if v_quantity < 0 then
      raise exception 'Stock is negative for "%"; reconcile it before finishing retail.', v_price.name;
    end if;
    if v_quantity > 0 then
      v_sale_id := md5('gsm-retail-day-close:' || v_today::text || ':' || v_price.product_id::text)::uuid;
      insert into public.retail_sales (
        id, product, mootais_sold, price_per_mootai, sale_date, notes, quantity_unit
      )
      values (
        v_sale_id,
        v_price.name,
        v_quantity,
        v_price.price_per_unit,
        v_today,
        'Retail day balance close',
        v_price.quantity_unit
      );
    end if;
  end loop;

  update public.retail_daily_sessions
  set status = 'finished', finished_at = now()
  where sale_date = v_today
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.inventory_start_retail_day(jsonb) from public, anon;
revoke all on function public.inventory_finish_retail_day() from public, anon;
grant execute on function public.inventory_start_retail_day(jsonb) to authenticated;
grant execute on function public.inventory_finish_retail_day() to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202610260001_retail_day_start_finish')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
