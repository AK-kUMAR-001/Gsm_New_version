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

revoke all on schema app_private from public, anon, authenticated;
revoke all on app_private.gsm_traders_owner from public, anon, authenticated;
alter table app_private.gsm_traders_owner enable row level security;
revoke all on function public.is_gsm_traders_owner() from public, anon;
grant execute on function public.is_gsm_traders_owner() to authenticated;

do $$
declare
  table_name text;
begin
  if not exists (
    select 1
    from app_private.gsm_traders_owner
    where singleton
  ) then
    raise exception 'Configure the GSM Traders owner with the setup query in app/supabase/README.md before applying this migration.';
  end if;

  foreach table_name in array array[
    'buyers', 'products', 'suppliers',
    'buyer_sales', 'retail_sales', 'buyer_payments'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', 'App owner can manage ' || replace(table_name, '_', ' '), table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_gsm_traders_owner()) with check (public.is_gsm_traders_owner())',
      'App owner can manage ' || replace(table_name, '_', ' '),
      table_name
    );
  end loop;
end;
$$;
