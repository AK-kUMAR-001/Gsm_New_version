create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  emoji text not null default '🌿',
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table public.buyer_sales (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id),
  product text not null check (length(trim(product)) > 0),
  mootais numeric(14, 3) not null check (mootais > 0),
  price_per_mootai numeric(14, 2) not null check (price_per_mootai >= 0),
  sale_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.retail_sales (
  id uuid primary key default gen_random_uuid(),
  product text not null check (length(trim(product)) > 0),
  mootais_sold numeric(14, 3) not null check (mootais_sold > 0),
  price_per_mootai numeric(14, 2) not null check (price_per_mootai > 0),
  sale_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.buyer_payments (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id),
  amount_paid numeric(14, 2) not null check (amount_paid > 0),
  paid_at date not null,
  notes text,
  created_at timestamptz not null default now()
);

create index buyer_sales_buyer_date_idx
  on public.buyer_sales (buyer_id, sale_date);
create index retail_sales_date_idx
  on public.retail_sales (sale_date);
create index buyer_payments_buyer_date_idx
  on public.buyer_payments (buyer_id, paid_at);

create schema app_private;
revoke all on schema app_private from public, anon, authenticated;
create table app_private.gsm_traders_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users(id) on delete cascade
);
revoke all on app_private.gsm_traders_owner from public, anon, authenticated;

create or replace function public.is_gsm_traders_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from app_private.gsm_traders_owner as owner
      where owner.singleton and owner.user_id = auth.uid()
    );
$$;

revoke all on function public.is_gsm_traders_owner() from public, anon;
grant execute on function public.is_gsm_traders_owner() to authenticated;

alter table public.buyers enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.buyer_sales enable row level security;
alter table public.retail_sales enable row level security;
alter table public.buyer_payments enable row level security;

revoke all on public.buyers, public.products, public.suppliers,
  public.buyer_sales, public.retail_sales, public.buyer_payments
  from public, anon;
grant select, insert, update, delete
  on public.buyers, public.products, public.suppliers,
     public.buyer_sales, public.retail_sales, public.buyer_payments
  to authenticated;

create policy "App owner can manage buyers"
  on public.buyers for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());
create policy "App owner can manage products"
  on public.products for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());
create policy "App owner can manage suppliers"
  on public.suppliers for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());
create policy "App owner can manage buyer sales"
  on public.buyer_sales for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());
create policy "App owner can manage retail sales"
  on public.retail_sales for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());
create policy "App owner can manage buyer payments"
  on public.buyer_payments for all to authenticated
  using (public.is_gsm_traders_owner())
  with check (public.is_gsm_traders_owner());
