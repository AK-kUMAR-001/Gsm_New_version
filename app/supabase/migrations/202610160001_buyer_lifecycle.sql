alter table public.buyers
  add column if not exists archived_at timestamptz;

create table if not exists app_private.buyer_purge_recycle_bin (
  purge_id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  purged_at timestamptz not null default now(),
  snapshot jsonb not null
);

alter table app_private.buyer_purge_recycle_bin enable row level security;
revoke all on app_private.buyer_purge_recycle_bin from public, anon, authenticated;

create or replace function public.set_buyer_archived(
  p_buyer_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can archive or restore a buyer.';
  end if;
  if p_buyer_id is null or p_archived is null then
    raise exception 'Choose a buyer and archive or restore action.';
  end if;

  perform 1 from public.buyers where id = p_buyer_id for update;
  if not found then
    raise exception 'Buyer not found.';
  end if;

  update public.buyers
  set archived_at = case
    when p_archived then coalesce(archived_at, now())
    else null
  end
  where id = p_buyer_id;
end;
$$;

revoke all on function public.set_buyer_archived(uuid, boolean) from public, anon;
grant execute on function public.set_buyer_archived(uuid, boolean) to authenticated;

create or replace function public.purge_archived_buyer(p_buyer_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_buyer public.buyers%rowtype;
  v_snapshot jsonb;
  v_legacy_payments jsonb := '[]'::jsonb;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can permanently purge a buyer.';
  end if;
  if p_buyer_id is null then
    raise exception 'Choose a buyer to permanently purge.';
  end if;

  select * into v_buyer
  from public.buyers
  where id = p_buyer_id
  for update;
  if not found then
    raise exception 'Buyer not found.';
  end if;
  if v_buyer.archived_at is null then
    raise exception 'Archive this buyer before permanently purging it.';
  end if;

  if to_regclass('public.payments') is not null then
    execute
      'select coalesce(jsonb_agg(to_jsonb(payment)), ''[]''::jsonb)
       from public.payments as payment
       where payment.buyer_id = $1'
      into v_legacy_payments
      using p_buyer_id;
  end if;

  v_snapshot := jsonb_build_object(
    'buyer', to_jsonb(v_buyer),
    'buyer_sales', coalesce((
      select jsonb_agg(to_jsonb(sale) order by sale.sale_date, sale.created_at, sale.id)
      from public.buyer_sales as sale
      where sale.buyer_id = p_buyer_id
    ), '[]'::jsonb),
    'buyer_payments', coalesce((
      select jsonb_agg(to_jsonb(payment) order by payment.paid_at, payment.created_at, payment.id)
      from public.buyer_payments as payment
      where payment.buyer_id = p_buyer_id
    ), '[]'::jsonb),
    'legacy_payments', v_legacy_payments,
    'inventory_stock_movements', case
      when to_regclass('public.inventory_stock_movements') is not null then (
        select coalesce(jsonb_agg(to_jsonb(movement) order by movement.id), '[]'::jsonb)
        from public.inventory_stock_movements as movement
        where movement.source_kind = 'buyer_sales'
          and movement.source_id in (
            select sale.id from public.buyer_sales as sale where sale.buyer_id = p_buyer_id
          )
      )
      else '[]'::jsonb
    end
  );

  insert into app_private.buyer_purge_recycle_bin (buyer_id, snapshot)
  values (p_buyer_id, v_snapshot);

  if to_regclass('public.inventory_stock_movements') is not null then
    insert into public.inventory_authorized_sale_deletions (transaction_id, buyer_sale_id)
    select txid_current(), sale.id
    from public.buyer_sales as sale
    where sale.buyer_id = p_buyer_id
    on conflict do nothing;

    execute
      'delete from public.inventory_stock_movements as movement
       where movement.source_kind = ''buyer_sales''
         and movement.source_id in (
           select sale.id from public.buyer_sales as sale where sale.buyer_id = $1
         )'
      using p_buyer_id;
  end if;

  delete from public.buyer_sales where buyer_id = p_buyer_id;
  if to_regclass('public.inventory_authorized_sale_deletions') is not null then
    delete from public.inventory_authorized_sale_deletions
    where transaction_id = txid_current();
  end if;
  delete from public.buyer_payments where buyer_id = p_buyer_id;
  if to_regclass('public.payments') is not null then
    execute 'delete from public.payments where buyer_id = $1' using p_buyer_id;
  end if;
  delete from public.buyers where id = p_buyer_id;
end;
$$;

revoke all on function public.purge_archived_buyer(uuid) from public, anon;
grant execute on function public.purge_archived_buyer(uuid) to authenticated;

-- Prevent legacy direct deletion from bypassing the recycle-bin purge transaction.
revoke all on function public.delete_buyer_and_all_data(uuid) from public, anon, authenticated;
revoke delete on public.buyers, public.buyer_sales, public.buyer_payments from authenticated;
do $$
begin
  if to_regclass('public.payments') is not null then
    execute 'revoke delete on public.payments from authenticated';
  end if;
end;
$$;

notify pgrst, 'reload schema';
