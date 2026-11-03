begin;

create table if not exists public.business_day_workflow_settings (
  singleton boolean primary key default true check (singleton),
  start_date date not null,
  created_at timestamptz not null default now()
);

insert into public.business_day_workflow_settings (singleton, start_date)
values (true, public.inventory_today_ist())
on conflict (singleton) do nothing;

create table if not exists public.business_day_buyer_progress (
  sale_date date not null,
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  status text not null check (status in ('sales_recorded', 'no_sale')),
  completed_at timestamptz not null default now(),
  completed_by uuid references auth.users(id) on delete set null,
  primary key (sale_date, buyer_id)
);

create table if not exists public.business_day_holidays (
  sale_date date primary key,
  marked_at timestamptz not null default now(),
  marked_by uuid references auth.users(id) on delete set null
);

insert into public.business_day_buyer_progress (sale_date, buyer_id, status)
select settings.start_date, sale.buyer_id, 'sales_recorded'
from public.business_day_workflow_settings settings
join public.buyer_sales sale on sale.sale_date = settings.start_date
where settings.singleton
group by settings.start_date, sale.buyer_id
on conflict (sale_date, buyer_id) do nothing;

alter table public.business_day_workflow_settings enable row level security;
alter table public.business_day_buyer_progress enable row level security;
alter table public.business_day_holidays enable row level security;

drop policy if exists "App owner can manage business day workflow settings"
  on public.business_day_workflow_settings;
create policy "App owner can manage business day workflow settings"
  on public.business_day_workflow_settings for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());

drop policy if exists "App owner can manage business day buyer progress"
  on public.business_day_buyer_progress;
create policy "App owner can manage business day buyer progress"
  on public.business_day_buyer_progress for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());

drop policy if exists "App owner can manage business day holidays"
  on public.business_day_holidays;
create policy "App owner can manage business day holidays"
  on public.business_day_holidays for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());

revoke all on public.business_day_workflow_settings,
  public.business_day_buyer_progress, public.business_day_holidays
  from public, anon;
grant select, insert, update, delete on public.business_day_workflow_settings,
  public.business_day_buyer_progress, public.business_day_holidays
  to authenticated;

create or replace function public.business_day_reject_holiday_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_sale_date date;
begin
  v_sale_date := coalesce(
    nullif(v_row ->> 'sale_date', ''),
    nullif(v_row ->> 'stock_date', ''),
    nullif(v_row ->> 'movement_date', '')
  )::date;

  if v_sale_date is not null and exists (
    select 1 from public.business_day_holidays holiday
    where holiday.sale_date = v_sale_date
  ) then
    raise exception 'This date is marked as a holiday. Remove the holiday from Retail before entering stock or sales.';
  end if;
  return new;
end;
$$;

drop trigger if exists business_day_holiday_guard on public.buyer_sales;
create trigger business_day_holiday_guard
  before insert or update on public.buyer_sales
  for each row execute function public.business_day_reject_holiday_entry();

drop trigger if exists business_day_holiday_guard on public.retail_sales;
create trigger business_day_holiday_guard
  before insert or update on public.retail_sales
  for each row execute function public.business_day_reject_holiday_entry();

drop trigger if exists business_day_holiday_guard on public.inventory_daily_counts;
create trigger business_day_holiday_guard
  before insert or update on public.inventory_daily_counts
  for each row execute function public.business_day_reject_holiday_entry();

drop trigger if exists business_day_holiday_guard on public.inventory_stock_movements;
create trigger business_day_holiday_guard
  before insert or update on public.inventory_stock_movements
  for each row execute function public.business_day_reject_holiday_entry();

drop trigger if exists business_day_holiday_guard on public.retail_daily_sessions;
create trigger business_day_holiday_guard
  before insert or update on public.retail_daily_sessions
  for each row execute function public.business_day_reject_holiday_entry();

drop trigger if exists business_day_holiday_guard on public.retail_daily_prices;
create trigger business_day_holiday_guard
  before insert or update on public.retail_daily_prices
  for each row execute function public.business_day_reject_holiday_entry();

create index if not exists business_day_buyer_progress_date_idx
  on public.business_day_buyer_progress (sale_date, buyer_id);

revoke all on function public.business_day_reject_holiday_entry() from public, anon, authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202611030001_daily_workflow_and_holidays')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
