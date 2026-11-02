begin;

create or replace function public.inventory_save_retail_day_prices(
  p_sale_date date,
  p_prices jsonb
)
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
    raise exception 'Only the configured GSM Traders owner can save retail prices.';
  end if;
  if p_sale_date is null or p_sale_date > v_today then
    raise exception 'Choose today or a past date to save retail prices.';
  end if;
  if jsonb_typeof(p_prices) is distinct from 'array' then
    raise exception 'Retail prices must be provided for each active tracked product.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('retail-day:' || p_sale_date::text, 0));
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
      on count_row.product_id = product.id and count_row.stock_date = p_sale_date
    where product.active and count_row.product_id is null
  ) then
    raise exception 'Record the physical morning count for every active tracked product on this date before saving retail prices.';
  end if;

  insert into public.retail_daily_sessions (sale_date, status, started_by)
  values (p_sale_date, 'active', auth.uid())
  on conflict (sale_date) do nothing;

  select * into v_session
  from public.retail_daily_sessions
  where sale_date = p_sale_date
  for update;

  insert into public.retail_daily_prices (sale_date, product_id, quantity_unit, price_per_unit)
  select p_sale_date, entry.product_id, entry.quantity_unit, entry.price_per_unit
  from jsonb_to_recordset(p_prices) as entry(product_id uuid, quantity_unit text, price_per_unit numeric)
  on conflict (sale_date, product_id) do update
  set quantity_unit = excluded.quantity_unit,
      price_per_unit = excluded.price_per_unit;

  return v_session;
end;
$$;

revoke all on function public.inventory_save_retail_day_prices(date, jsonb)
  from public, anon;
grant execute on function public.inventory_save_retail_day_prices(date, jsonb)
  to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202611020001_retail_prices_for_selected_date')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
