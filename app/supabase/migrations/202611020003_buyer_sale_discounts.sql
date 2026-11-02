begin;

alter table public.buyer_sales
  add column discounted_bill_total numeric(14, 2),
  add constraint buyer_sales_discounted_bill_total_check
    check (
      discounted_bill_total is null
      or (
        discounted_bill_total >= 0
        and discounted_bill_total <= round(mootais * price_per_mootai, 2)
      )
    );

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

  select coalesce(sum(coalesce(
    sale.discounted_bill_total,
    round(sale.mootais * sale.price_per_mootai, 2)
  )), 0)::numeric(14, 2)
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

create or replace function public.inventory_record_buyer_sale_with_unit(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text,
  p_discounted_bill_total numeric
)
returns public.buyer_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.buyer_sales;
  v_discount numeric(14, 2);
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can record buyer sales.';
  end if;
  if p_discounted_bill_total is not null then
    if p_discounted_bill_total < 0
      or p_discounted_bill_total > round(p_quantity * p_price_per_unit, 2) then
      raise exception 'Discounted bill total must be between zero and the original bill total.';
    end if;
    v_discount := p_discounted_bill_total::numeric(14, 2);
    if v_discount = round(p_quantity * p_price_per_unit, 2)::numeric(14, 2) then
      v_discount := null;
    end if;
  end if;

  v_sale := public.inventory_record_buyer_sale_with_unit(
    p_id,
    p_buyer_id,
    p_product,
    p_quantity,
    p_quantity_unit,
    p_price_per_unit,
    p_sale_date,
    p_notes
  );

  insert into app_private.inventory_authorized_sale_mutations (
    transaction_id, sale_table, sale_id, operation
  )
  values (txid_current(), 'buyer_sales', v_sale.id, 'UPDATE')
  on conflict do nothing;

  update public.buyer_sales
  set discounted_bill_total = v_discount
  where id = v_sale.id
  returning * into v_sale;

  delete from app_private.inventory_authorized_sale_mutations
  where transaction_id = txid_current()
    and sale_table = 'buyer_sales'
    and sale_id = v_sale.id
    and operation = 'UPDATE';

  return v_sale;
end;
$$;

create or replace function public.inventory_update_buyer_sale(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text,
  p_discounted_bill_total numeric
)
returns public.buyer_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.buyer_sales;
  v_discount numeric(14, 2);
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can correct sales.';
  end if;
  if p_discounted_bill_total is not null then
    if p_discounted_bill_total < 0
      or p_discounted_bill_total > round(p_quantity * p_price_per_unit, 2) then
      raise exception 'Discounted bill total must be between zero and the original bill total.';
    end if;
    v_discount := p_discounted_bill_total::numeric(14, 2);
    if v_discount = round(p_quantity * p_price_per_unit, 2)::numeric(14, 2) then
      v_discount := null;
    end if;
  end if;

  v_sale := public.inventory_update_buyer_sale(
    p_id,
    p_buyer_id,
    p_product,
    p_quantity,
    p_quantity_unit,
    p_price_per_unit,
    p_sale_date,
    p_notes
  );

  insert into app_private.inventory_authorized_sale_mutations (
    transaction_id, sale_table, sale_id, operation
  )
  values (txid_current(), 'buyer_sales', v_sale.id, 'UPDATE')
  on conflict do nothing;

  update public.buyer_sales
  set discounted_bill_total = v_discount
  where id = v_sale.id
  returning * into v_sale;

  delete from app_private.inventory_authorized_sale_mutations
  where transaction_id = txid_current()
    and sale_table = 'buyer_sales'
    and sale_id = v_sale.id
    and operation = 'UPDATE';

  return v_sale;
end;
$$;

revoke all on function public.inventory_record_buyer_sale_with_unit(
  uuid, uuid, text, numeric, text, numeric, date, text, numeric
) from public, anon;
revoke all on function public.inventory_update_buyer_sale(
  uuid, uuid, text, numeric, text, numeric, date, text, numeric
) from public, anon;
grant execute on function public.inventory_record_buyer_sale_with_unit(
  uuid, uuid, text, numeric, text, numeric, date, text, numeric
) to authenticated;
grant execute on function public.inventory_update_buyer_sale(
  uuid, uuid, text, numeric, text, numeric, date, text, numeric
) to authenticated;

insert into app_private.applied_data_migrations(migration_name)
values ('202611020003_buyer_sale_discounts')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
