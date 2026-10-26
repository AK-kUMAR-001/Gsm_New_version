begin;

create table if not exists app_private.inventory_morning_count_deletions (
  id bigint generated always as identity primary key,
  product_id uuid not null,
  stock_date date not null,
  previous_count jsonb not null,
  removed_count_movements jsonb not null,
  deleted_by uuid not null default auth.uid(),
  deleted_at timestamptz not null default now()
);

revoke all on app_private.inventory_morning_count_deletions from public, anon, authenticated;

create or replace function public.inventory_delete_morning_count(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_today date := public.inventory_today_ist();
  v_count public.inventory_daily_counts;
  v_count_movements jsonb;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can delete a morning count.';
  end if;
  if p_product_id is null then
    raise exception 'Choose a product before deleting its morning count.';
  end if;

  perform 1
  from public.inventory_product_settings
  where product_id = p_product_id
  for update;
  if not found then
    raise exception 'Stock tracking is not enabled for this product.';
  end if;

  select *
  into v_count
  from public.inventory_daily_counts
  where product_id = p_product_id and stock_date = v_today
  for update;
  if not found then
    raise exception 'No morning count exists for this product today.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.created_at, movement.id), '[]'::jsonb)
  into v_count_movements
  from public.inventory_stock_movements as movement
  where movement.product_id = p_product_id
    and movement.movement_date = v_today
    and (
      (movement.movement_type = 'count_adjustment' and movement.reason like 'Morning physical count %')
      or (movement.movement_type = 'count_revaluation' and movement.reason = 'Morning physical count valuation correction')
    );

  insert into app_private.inventory_morning_count_deletions (
    product_id, stock_date, previous_count, removed_count_movements, deleted_by
  )
  values (p_product_id, v_today, to_jsonb(v_count), v_count_movements, auth.uid());

  delete from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = v_today
    and (
      (movement_type = 'count_adjustment' and reason like 'Morning physical count %')
      or (movement_type = 'count_revaluation' and reason = 'Morning physical count valuation correction')
    );

  delete from public.inventory_daily_counts
  where product_id = p_product_id and stock_date = v_today;
end;
$$;

revoke all on function public.inventory_delete_morning_count(uuid) from public, anon;
grant execute on function public.inventory_delete_morning_count(uuid) to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202610270002_delete_morning_count')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
