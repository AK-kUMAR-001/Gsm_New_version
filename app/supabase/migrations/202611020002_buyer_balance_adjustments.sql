begin;

create table public.buyer_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id),
  old_balance numeric(14, 2) not null check (old_balance >= 0),
  new_balance numeric(14, 2) not null check (new_balance >= 0),
  adjustment_amount numeric(14, 2) not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index buyer_balance_adjustments_buyer_created_idx
  on public.buyer_balance_adjustments (buyer_id, created_at);

alter table public.buyer_balance_adjustments enable row level security;
revoke all on public.buyer_balance_adjustments from public, anon;
grant select on public.buyer_balance_adjustments to authenticated;

create policy "App owner can view buyer balance adjustments"
  on public.buyer_balance_adjustments
  for select to authenticated
  using (public.is_gsm_traders_owner());

create or replace function public.inventory_update_buyer_balance(
  p_buyer_id uuid,
  p_new_balance numeric
)
returns public.buyer_balance_adjustments
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_buyer_id uuid;
  v_sales numeric(14, 2);
  v_payments numeric(14, 2);
  v_payment_rows bigint;
  v_previous_adjustments numeric(14, 2);
  v_signed_balance numeric(14, 2);
  v_old_balance numeric(14, 2);
  v_adjustment public.buyer_balance_adjustments%rowtype;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can update buyer balances.';
  end if;
  if p_buyer_id is null then
    raise exception 'Choose a buyer to update.';
  end if;
  if p_new_balance is null or p_new_balance < 0 or p_new_balance > 999999999999.99 then
    raise exception 'Enter a valid balance amount of zero or more.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('buyer-balance:' || p_buyer_id::text, 0));
  select buyer.id into v_buyer_id
  from public.buyers as buyer
  where buyer.id = p_buyer_id
  for update;
  if not found then
    raise exception 'Buyer not found.';
  end if;

  select coalesce(sum(sale.mootais * sale.price_per_mootai), 0)::numeric(14, 2)
    into v_sales
  from public.buyer_sales as sale
  where sale.buyer_id = p_buyer_id;

  select coalesce(sum(payment.amount_paid), 0)::numeric(14, 2), count(*)
    into v_payments, v_payment_rows
  from public.buyer_payments as payment
  where payment.buyer_id = p_buyer_id;

  if v_payment_rows = 0 and to_regclass('public.payments') is not null then
    execute
      'select coalesce(sum(payment.amount_paid), 0)::numeric(14, 2)
       from public.payments as payment
       where payment.buyer_id = $1'
      into v_payments
      using p_buyer_id;
  end if;

  select coalesce(sum(adjustment.adjustment_amount), 0)::numeric(14, 2)
    into v_previous_adjustments
  from public.buyer_balance_adjustments as adjustment
  where adjustment.buyer_id = p_buyer_id;

  v_signed_balance := round(v_sales - v_payments + v_previous_adjustments, 2)::numeric(14, 2);
  v_old_balance := greatest(0, v_signed_balance);

  insert into public.buyer_balance_adjustments (
    buyer_id,
    old_balance,
    new_balance,
    adjustment_amount,
    changed_by
  )
  values (
    p_buyer_id,
    v_old_balance,
    p_new_balance::numeric(14, 2),
    (p_new_balance - v_signed_balance)::numeric(14, 2),
    auth.uid()
  )
  returning * into v_adjustment;

  return v_adjustment;
end;
$$;

revoke all on function public.inventory_update_buyer_balance(uuid, numeric)
  from public, anon;
grant execute on function public.inventory_update_buyer_balance(uuid, numeric)
  to authenticated;

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
    'buyer_balance_adjustments', coalesce((
      select jsonb_agg(to_jsonb(adjustment) order by adjustment.created_at, adjustment.id)
      from public.buyer_balance_adjustments as adjustment
      where adjustment.buyer_id = p_buyer_id
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
  delete from public.buyer_balance_adjustments where buyer_id = p_buyer_id;

  if to_regclass('public.payments') is not null then
    execute 'delete from public.payments where buyer_id = $1' using p_buyer_id;
  end if;

  delete from public.buyers where id = p_buyer_id;
end;
$$;

revoke all on function public.purge_archived_buyer(uuid) from public, anon;
grant execute on function public.purge_archived_buyer(uuid) to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202611020002_buyer_balance_adjustments')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
