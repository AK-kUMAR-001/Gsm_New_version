begin;

create or replace function public.inventory_record_receipt(
  p_product_id uuid,
  p_supplier_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_notes text default null,
  p_request_id uuid default null
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.inventory_stock_movements;
  v_reason text := coalesce(nullif(trim(p_notes), ''), 'Supplier stock receipt');
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can record a stock receipt.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Received quantity must be greater than zero.';
  end if;
  if p_unit_cost is null or p_unit_cost <= 0 then
    raise exception 'Purchase cost per Mootai must be greater than zero.';
  end if;
  if p_request_id is null then
    raise exception 'A stock receipt request ID is required.';
  end if;

  perform 1 from public.inventory_product_settings
    where product_id = p_product_id for update;
  if not found then
    raise exception 'Start stock tracking for this product before recording a receipt.';
  end if;
  if p_supplier_id is not null
    and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Select a valid supplier.';
  end if;

  insert into public.inventory_stock_movements (
    product_id, movement_type, quantity_delta, cost_delta, movement_date,
    supplier_id, source_kind, source_id, reason, recorded_by
  )
  values (
    p_product_id, 'receipt', p_quantity,
    round(p_quantity * p_unit_cost, 2), public.inventory_today_ist(),
    p_supplier_id, 'receipt', p_request_id, v_reason, auth.uid()
  )
  on conflict (source_kind, source_id) do nothing
  returning * into v_movement;

  if not found then
    select * into v_movement
    from public.inventory_stock_movements
    where source_kind = 'receipt' and source_id = p_request_id;
    if v_movement.product_id is distinct from p_product_id
      or v_movement.supplier_id is distinct from p_supplier_id
      or v_movement.quantity_delta is distinct from round(p_quantity, 3)
      or v_movement.cost_delta is distinct from round(p_quantity * p_unit_cost, 2)
      or v_movement.reason is distinct from v_reason then
      raise exception 'Receipt request ID was already used for different stock details.';
    end if;
  end if;

  return v_movement;
end;
$$;

revoke all on function public.inventory_record_receipt(uuid, uuid, numeric, numeric, text, uuid) from public, anon;
grant execute on function public.inventory_record_receipt(uuid, uuid, numeric, numeric, text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
