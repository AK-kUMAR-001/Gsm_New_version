create or replace function public.inventory_set_stock_quantity(
  p_product_id uuid,
  p_target_quantity numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_request_id uuid default null
)
returns numeric(14, 3)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_quantity numeric(14, 3);
  v_target_quantity numeric(14, 3);
  v_quantity_delta numeric(14, 3);
begin
  if p_target_quantity is null or p_target_quantity < 0 then
    raise exception 'Corrected stock balance cannot be negative.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Enter a reason for the stock correction.';
  end if;
  if p_request_id is null then
    raise exception 'A stock correction request ID is required.';
  end if;

  perform 1
  from public.inventory_product_settings
  where product_id = p_product_id
  for update;
  if not found then
    raise exception 'Start stock tracking for this product first.';
  end if;

  select coalesce(sum(quantity_delta), 0)
  into v_current_quantity
  from public.inventory_stock_movements
  where product_id = p_product_id;

  v_target_quantity := round(p_target_quantity, 3);
  v_quantity_delta := v_target_quantity - v_current_quantity;

  if v_quantity_delta <> 0 then
    perform public.inventory_record_adjustment(
      p_product_id,
      'correction',
      v_quantity_delta,
      p_reason,
      p_unit_cost,
      p_request_id
    );
  end if;

  return v_target_quantity;
end;
$$;

revoke all on function public.inventory_set_stock_quantity(uuid, numeric, text, numeric, uuid) from public, anon;
grant execute on function public.inventory_set_stock_quantity(uuid, numeric, text, numeric, uuid) to authenticated;

notify pgrst, 'reload schema';
