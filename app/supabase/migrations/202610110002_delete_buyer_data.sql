create table if not exists public.inventory_authorized_sale_deletions (
  transaction_id bigint not null,
  buyer_sale_id uuid not null,
  primary key (transaction_id, buyer_sale_id)
);

alter table public.inventory_authorized_sale_deletions enable row level security;
revoke all on public.inventory_authorized_sale_deletions from anon, authenticated;

create or replace function public.inventory_prevent_tracked_sale_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorized boolean := false;
  v_tracked boolean := false;
begin
  if tg_op = 'DELETE' and to_regclass('public.inventory_authorized_sale_deletions') is not null then
    execute
      'select exists (
         select 1
         from public.inventory_authorized_sale_deletions
         where transaction_id = txid_current() and buyer_sale_id = $1
       )'
      into v_authorized
      using old.id;
    if v_authorized then
      return old;
    end if;
  end if;

  if to_regclass('public.inventory_product_settings') is not null
    and to_regclass('public.products') is not null then
    execute
      'select exists (
         select 1
         from public.products as product
         join public.inventory_product_settings as setting on setting.product_id = product.id
         where product.name = $1
       )'
      into v_tracked
      using old.product;
  end if;

  if v_tracked then
    raise exception 'Stock-tracked sales cannot be edited or deleted except when deleting the complete buyer record.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.delete_buyer_and_all_data(p_buyer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to delete a buyer.';
  end if;
  if p_buyer_id is null then
    raise exception 'Choose a buyer to delete.';
  end if;

  perform 1 from public.buyers where id = p_buyer_id for update;
  if not found then
    raise exception 'Buyer not found.';
  end if;

  if to_regclass('public.inventory_stock_movements') is not null then
    insert into public.inventory_authorized_sale_deletions (transaction_id, buyer_sale_id)
    select txid_current(), id
    from public.buyer_sales
    where buyer_id = p_buyer_id
    on conflict do nothing;

    execute
      'delete from public.inventory_stock_movements as movement
       using public.buyer_sales as sale
       where sale.buyer_id = $1
         and movement.source_kind = ''buyer_sales''
         and movement.source_id = sale.id'
      using p_buyer_id;
  end if;

  delete from public.buyer_sales where buyer_id = p_buyer_id;
  delete from public.inventory_authorized_sale_deletions
  where transaction_id = txid_current();

  if to_regclass('public.buyer_payments') is not null then
    execute 'delete from public.buyer_payments where buyer_id = $1' using p_buyer_id;
  end if;
  if to_regclass('public.payments') is not null then
    execute 'delete from public.payments where buyer_id = $1' using p_buyer_id;
  end if;

  delete from public.buyers where id = p_buyer_id;
end;
$$;

revoke all on function public.delete_buyer_and_all_data(uuid) from public, anon;
grant execute on function public.delete_buyer_and_all_data(uuid) to authenticated;

notify pgrst, 'reload schema';
