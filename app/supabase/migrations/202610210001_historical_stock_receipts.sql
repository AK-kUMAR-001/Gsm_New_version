create or replace function public.inventory_record_historical_receipt_with_damage(
  p_product_id uuid,
  p_supplier_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_notes text,
  p_request_id uuid,
  p_damaged_quantity numeric,
  p_damage_reason text,
  p_damage_request_id uuid,
  p_movement_date date
)
returns public.inventory_stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.inventory_stock_movements;
  v_existing public.inventory_stock_movements;
begin
  if not public.is_gsm_traders_owner() then
    raise exception 'Only the configured GSM Traders owner can record a supplier receipt.';
  end if;
  if p_movement_date is null or p_movement_date > public.inventory_today_ist() then
    raise exception 'Stock-in date must be today or earlier.';
  end if;

  select * into v_existing
  from public.inventory_stock_movements
  where source_kind = 'receipt' and source_id = p_request_id;
  if found and v_existing.movement_date is distinct from p_movement_date then
    raise exception 'Receipt request ID was already used for a different stock-in date.';
  end if;

  if p_damaged_quantity > 0 then
    select * into v_existing
    from public.inventory_stock_movements
    where source_kind = 'adjustment' and source_id = p_damage_request_id;
    if found and v_existing.movement_date is distinct from p_movement_date then
      raise exception 'Damage request ID was already used for a different stock-in date.';
    end if;
  end if;

  v_receipt := public.inventory_record_receipt_with_damage(
    p_product_id,
    p_supplier_id,
    p_quantity,
    p_unit_cost,
    p_notes,
    p_request_id,
    p_damaged_quantity,
    p_damage_reason,
    p_damage_request_id
  );

  update public.inventory_stock_movements
  set movement_date = p_movement_date
  where source_kind = 'receipt' and source_id = p_request_id;

  if p_damaged_quantity > 0 then
    update public.inventory_stock_movements
    set movement_date = p_movement_date
    where source_kind = 'adjustment' and source_id = p_damage_request_id;
  end if;

  select * into v_receipt
  from public.inventory_stock_movements
  where source_kind = 'receipt' and source_id = p_request_id;
  return v_receipt;
end;
$$;

revoke all on function public.inventory_record_historical_receipt_with_damage(
  uuid, uuid, numeric, numeric, text, uuid, numeric, text, uuid, date
) from public, anon;
grant execute on function public.inventory_record_historical_receipt_with_damage(
  uuid, uuid, numeric, numeric, text, uuid, numeric, text, uuid, date
) to authenticated;
