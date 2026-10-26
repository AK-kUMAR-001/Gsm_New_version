begin;

-- Keep a private snapshot before each destructive stock-ledger operation.

create table if not exists app_private.inventory_stock_deletion_audit (
  id bigint generated always as identity primary key,
  operation text not null,
  product_id uuid,
  stock_date date not null,
  requested_movement_id bigint,
  deleted_data jsonb not null,
  deleted_by uuid not null default auth.uid(),
  deleted_at timestamptz not null default now()
);

alter table app_private.inventory_stock_deletion_audit enable row level security;
revoke all on app_private.inventory_stock_deletion_audit from public, anon, authenticated;

create or replace function app_private.inventory_cancel_retail_day(p_stock_date date)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_session public.retail_daily_sessions%rowtype;
  v_sale public.retail_sales%rowtype;
  v_has_session boolean := false;
  v_session_snapshot jsonb;
  v_prices_snapshot jsonb;
  v_sales_snapshot jsonb;
  v_movements_snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('retail-day:' || p_stock_date::text, 0));

  select * into v_session
  from public.retail_daily_sessions
  where sale_date = p_stock_date
  for update;
  v_has_session := found;
  if v_has_session then
    v_session_snapshot := to_jsonb(v_session);
  end if;

  select coalesce(jsonb_agg(to_jsonb(price) order by price.product_id), '[]'::jsonb)
  into v_prices_snapshot
  from public.retail_daily_prices as price
  where price.sale_date = p_stock_date;

  select coalesce(jsonb_agg(to_jsonb(sale) order by sale.id), '[]'::jsonb)
  into v_sales_snapshot
  from public.retail_sales as sale
  join public.products as product on product.name = sale.product
  where sale.sale_date = p_stock_date
    and sale.notes = 'Retail day balance close'
    and sale.id = md5(
      'gsm-retail-day-close:' || p_stock_date::text || ':' || product.id::text
    )::uuid;

  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.id), '[]'::jsonb)
  into v_movements_snapshot
  from public.inventory_stock_movements as movement
  where movement.source_kind = 'retail_sales'
    and movement.source_id in (
      select sale.id
      from public.retail_sales as sale
      join public.products as product on product.name = sale.product
      where sale.sale_date = p_stock_date
        and sale.notes = 'Retail day balance close'
        and sale.id = md5(
          'gsm-retail-day-close:' || p_stock_date::text || ':' || product.id::text
        )::uuid
    );

  if v_has_session
    or jsonb_array_length(v_sales_snapshot) > 0
    or jsonb_array_length(v_prices_snapshot) > 0 then
    insert into app_private.inventory_stock_deletion_audit (
      operation, stock_date, deleted_data
    )
    values (
      'cancel_retail_day',
      p_stock_date,
      jsonb_build_object(
        'session', v_session_snapshot,
        'prices', v_prices_snapshot,
        'generated_close_sales', v_sales_snapshot,
        'generated_close_movements', v_movements_snapshot
      )
    );
  end if;

  for v_sale in
    select sale.*
    from public.retail_sales as sale
    join public.products as product on product.name = sale.product
    where sale.sale_date = p_stock_date
      and sale.notes = 'Retail day balance close'
      and sale.id = md5(
        'gsm-retail-day-close:' || p_stock_date::text || ':' || product.id::text
      )::uuid
    for update of sale
  loop
    perform public.inventory_delete_retail_sale(v_sale.id);
  end loop;

  delete from public.retail_daily_prices where sale_date = p_stock_date;
  delete from public.retail_daily_sessions where sale_date = p_stock_date;
end;
$$;

revoke all on function app_private.inventory_cancel_retail_day(date) from public, anon, authenticated;

create or replace function public.inventory_delete_morning_count(
  p_product_id uuid,
  p_stock_date date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_stock_date date := coalesce(p_stock_date, public.inventory_today_ist());
  v_count public.inventory_daily_counts%rowtype;
  v_count_snapshot jsonb;
  v_movements_snapshot jsonb;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can delete a morning stock count.';
  end if;
  if p_product_id is null then
    raise exception 'Choose a product whose morning stock count should be deleted.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('retail-day:' || v_stock_date::text, 0));

  perform 1
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Product not found.';
  end if;

  perform 1
  from public.inventory_product_settings
  where product_id = p_product_id
  for update;
  if not found then
    raise exception 'Stock tracking is not enabled for this product.';
  end if;

  select * into v_count
  from public.inventory_daily_counts
  where product_id = p_product_id and stock_date = v_stock_date
  for update;
  if not found then
    raise exception 'No morning stock count exists for this product and date.';
  end if;

  v_count_snapshot := to_jsonb(v_count);
  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.id), '[]'::jsonb)
  into v_movements_snapshot
  from public.inventory_stock_movements as movement
  where movement.product_id = p_product_id
    and movement.movement_date = v_stock_date
    and (
      (movement.movement_type = 'count_adjustment'
        and movement.reason like 'Morning physical count %')
      or (movement.movement_type = 'count_revaluation'
        and movement.reason = 'Morning physical count valuation correction')
    );

  insert into app_private.inventory_stock_deletion_audit (
    operation, product_id, stock_date, deleted_data
  )
  values (
    'delete_morning_count',
    p_product_id,
    v_stock_date,
    jsonb_build_object(
      'count', v_count_snapshot,
      'count_movements', v_movements_snapshot
    )
  );

  perform app_private.inventory_cancel_retail_day(v_stock_date);

  delete from public.inventory_stock_movements
  where product_id = p_product_id
    and movement_date = v_stock_date
    and (
      (movement_type = 'count_adjustment'
        and reason like 'Morning physical count %')
      or (movement_type = 'count_revaluation'
        and reason = 'Morning physical count valuation correction')
    );

  delete from public.inventory_daily_counts
  where product_id = p_product_id and stock_date = v_stock_date;
end;
$$;

create or replace function public.inventory_delete_morning_count(p_product_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, app_private
as $$
  select public.inventory_delete_morning_count(
    p_product_id,
    public.inventory_today_ist()
  );
$$;

create or replace function public.inventory_delete_stock_movement(p_movement_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_movement public.inventory_stock_movements%rowtype;
  v_locked_movement public.inventory_stock_movements%rowtype;
  v_sale_snapshot jsonb;
  v_buyer_id uuid;
  v_source_exists boolean := false;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can delete stock movements.';
  end if;
  if p_movement_id is null then
    raise exception 'Choose a stock movement to delete.';
  end if;

  select * into v_movement
  from public.inventory_stock_movements
  where id = p_movement_id;
  if not found then
    raise exception 'Stock movement not found.';
  end if;

  if v_movement.movement_type = 'sale' and v_movement.source_kind = 'buyer_sales' then
    select buyer_id into v_buyer_id
    from public.buyer_sales
    where id = v_movement.source_id;
    if found then
      perform 1 from public.buyers where id = v_buyer_id for key share;
    end if;
    select to_jsonb(sale) into v_sale_snapshot
    from public.buyer_sales as sale
    where sale.id = v_movement.source_id
    for update;
    v_source_exists := found;

    if v_source_exists then
      insert into app_private.inventory_stock_deletion_audit (
        operation, product_id, stock_date, requested_movement_id, deleted_data
      )
      values (
        'delete_buyer_sale_movement',
        v_movement.product_id,
        v_movement.movement_date,
        v_movement.id,
        jsonb_build_object('movement', to_jsonb(v_movement), 'buyer_sale', v_sale_snapshot)
      );
      perform public.inventory_delete_buyer_sale(v_movement.source_id);
    else
      perform 1 from public.products where id = v_movement.product_id for update;
      perform 1 from public.inventory_product_settings
      where product_id = v_movement.product_id for update;
      select * into v_locked_movement
      from public.inventory_stock_movements
      where id = v_movement.id
      for update;
      if not found then
        raise exception 'Stock movement no longer exists.';
      end if;
      if v_locked_movement is distinct from v_movement then
        raise exception 'Stock movement changed while being deleted. Refresh and try again.';
      end if;
      insert into app_private.inventory_stock_deletion_audit (
        operation, product_id, stock_date, requested_movement_id, deleted_data
      )
      values (
        'delete_buyer_sale_movement',
        v_locked_movement.product_id,
        v_locked_movement.movement_date,
        v_locked_movement.id,
        jsonb_build_object('movement', to_jsonb(v_locked_movement), 'buyer_sale', null)
      );
      delete from public.inventory_stock_movements where id = v_movement.id;
    end if;
    return;
  end if;

  if v_movement.movement_type = 'sale' and v_movement.source_kind = 'retail_sales' then
    select to_jsonb(sale) into v_sale_snapshot
    from public.retail_sales as sale
    where sale.id = v_movement.source_id
    for update;
    v_source_exists := found;

    if v_source_exists
      and v_sale_snapshot->>'notes' = 'Retail day balance close'
      and (v_sale_snapshot->>'id')::uuid = md5(
        'gsm-retail-day-close:' || v_movement.movement_date::text || ':' || v_movement.product_id::text
      )::uuid then
      perform app_private.inventory_cancel_retail_day(v_movement.movement_date);
      return;
    end if;

    if v_source_exists then
      insert into app_private.inventory_stock_deletion_audit (
        operation, product_id, stock_date, requested_movement_id, deleted_data
      )
      values (
        'delete_retail_sale_movement',
        v_movement.product_id,
        v_movement.movement_date,
        v_movement.id,
        jsonb_build_object('movement', to_jsonb(v_movement), 'retail_sale', v_sale_snapshot)
      );
      perform public.inventory_delete_retail_sale(v_movement.source_id);
    else
      perform 1 from public.products where id = v_movement.product_id for update;
      perform 1 from public.inventory_product_settings
      where product_id = v_movement.product_id for update;
      select * into v_locked_movement
      from public.inventory_stock_movements
      where id = v_movement.id
      for update;
      if not found then
        raise exception 'Stock movement no longer exists.';
      end if;
      if v_locked_movement is distinct from v_movement then
        raise exception 'Stock movement changed while being deleted. Refresh and try again.';
      end if;
      insert into app_private.inventory_stock_deletion_audit (
        operation, product_id, stock_date, requested_movement_id, deleted_data
      )
      values (
        'delete_retail_sale_movement',
        v_locked_movement.product_id,
        v_locked_movement.movement_date,
        v_locked_movement.id,
        jsonb_build_object('movement', to_jsonb(v_locked_movement), 'retail_sale', null)
      );
      delete from public.inventory_stock_movements where id = v_movement.id;
    end if;
    return;
  end if;

  if v_movement.movement_type in ('count_adjustment', 'count_revaluation')
    and exists (
      select 1 from public.inventory_daily_counts as count_row
      where count_row.product_id = v_movement.product_id
        and count_row.stock_date = v_movement.movement_date
    ) then
    perform public.inventory_delete_morning_count(v_movement.product_id, v_movement.movement_date);
    return;
  end if;

  if v_movement.movement_type not in (
    'opening', 'receipt', 'spoilage', 'correction', 'count_adjustment', 'count_revaluation'
  ) then
    raise exception 'This stock movement cannot be deleted from the inventory ledger.';
  end if;

  if v_movement.source_kind not in ('receipt', 'adjustment')
    and v_movement.source_kind is not null then
    raise exception 'This stock movement has an unsupported linked record and cannot be deleted.';
  end if;

  perform 1 from public.products where id = v_movement.product_id for update;
  perform 1 from public.inventory_product_settings
  where product_id = v_movement.product_id for update;
  select * into v_locked_movement
  from public.inventory_stock_movements
  where id = v_movement.id
  for update;
  if not found then
    raise exception 'Stock movement no longer exists.';
  end if;
  if v_locked_movement is distinct from v_movement then
    raise exception 'Stock movement changed while being deleted. Refresh and try again.';
  end if;

  insert into app_private.inventory_stock_deletion_audit (
    operation, product_id, stock_date, requested_movement_id, deleted_data
  )
  values (
    'delete_stock_movement',
    v_locked_movement.product_id,
    v_locked_movement.movement_date,
    v_locked_movement.id,
    jsonb_build_object('movement', to_jsonb(v_locked_movement))
  );

  delete from public.inventory_stock_movements where id = v_locked_movement.id;
end;
$$;

revoke all on function public.inventory_delete_morning_count(uuid, date) from public, anon;
revoke all on function public.inventory_delete_morning_count(uuid) from public, anon;
revoke all on function public.inventory_delete_stock_movement(bigint) from public, anon;
grant execute on function public.inventory_delete_morning_count(uuid, date) to authenticated;
grant execute on function public.inventory_delete_morning_count(uuid) to authenticated;
grant execute on function public.inventory_delete_stock_movement(bigint) to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202610270003_delete_stock_and_reopen_retail_day')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
