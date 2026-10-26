begin;

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
    raise exception 'Only the configured GSM Traders owner can permanently delete a buyer.';
  end if;
  if p_buyer_id is null then
    raise exception 'Choose a buyer to permanently delete.';
  end if;

  select * into v_buyer
  from public.buyers
  where id = p_buyer_id
  for update;
  if not found then
    raise exception 'Buyer not found.';
  end if;
  if v_buyer.archived_at is null then
    raise exception 'Archive this buyer before permanently deleting them.';
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
    'inventory_stock_movements', coalesce((
      select jsonb_agg(to_jsonb(movement) order by movement.id)
      from public.inventory_stock_movements as movement
      where movement.source_kind = 'buyer_sales'
        and movement.source_id in (
          select sale.id from public.buyer_sales as sale where sale.buyer_id = p_buyer_id
        )
    ), '[]'::jsonb)
  );

  insert into app_private.buyer_purge_recycle_bin (buyer_id, snapshot)
  values (p_buyer_id, v_snapshot);

  insert into public.inventory_authorized_sale_deletions (transaction_id, buyer_sale_id)
  select txid_current(), sale.id
  from public.buyer_sales as sale
  where sale.buyer_id = p_buyer_id
  on conflict do nothing;

  delete from public.inventory_stock_movements as movement
  using public.buyer_sales as sale
  where sale.buyer_id = p_buyer_id
    and movement.source_kind = 'buyer_sales'
    and movement.source_id = sale.id;

  delete from public.buyer_sales where buyer_id = p_buyer_id;
  delete from public.inventory_authorized_sale_deletions
  where transaction_id = txid_current();
  delete from public.buyer_payments where buyer_id = p_buyer_id;

  if to_regclass('public.payments') is not null then
    execute 'delete from public.payments where buyer_id = $1' using p_buyer_id;
  end if;

  delete from public.buyers where id = p_buyer_id;
end;
$$;

revoke all on function public.purge_archived_buyer(uuid) from public, anon;
grant execute on function public.purge_archived_buyer(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
