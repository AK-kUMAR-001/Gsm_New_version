begin;

create or replace function public.inventory_record_buyer_sale_with_unit(
  p_id uuid,
  p_buyer_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text default null
)
returns public.buyer_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product_matches integer;
begin
  select count(*) into v_product_matches
  from public.products
  where name = p_product;

  if v_product_matches <> 1 then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;

  return public.inventory_record_buyer_sale(
    p_id,
    p_buyer_id,
    p_product,
    p_quantity,
    p_price_per_unit,
    p_sale_date,
    p_quantity_unit,
    p_notes
  );
end;
$$;

create or replace function public.inventory_record_retail_sale_with_unit(
  p_id uuid,
  p_product text,
  p_quantity numeric,
  p_quantity_unit text,
  p_price_per_unit numeric,
  p_sale_date date,
  p_notes text default null
)
returns public.retail_sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product_matches integer;
begin
  select count(*) into v_product_matches
  from public.products
  where name = p_product;

  if v_product_matches <> 1 then
    raise exception 'The sale product must match exactly one product in the catalog.';
  end if;

  return public.inventory_record_retail_sale(
    p_id,
    p_product,
    p_quantity,
    p_price_per_unit,
    p_sale_date,
    p_quantity_unit,
    p_notes
  );
end;
$$;

revoke all on function public.inventory_record_buyer_sale_with_unit(uuid, uuid, text, numeric, text, numeric, date, text) from public, anon;
revoke all on function public.inventory_record_retail_sale_with_unit(uuid, text, numeric, text, numeric, date, text) from public, anon;
grant execute on function public.inventory_record_buyer_sale_with_unit(uuid, uuid, text, numeric, text, numeric, date, text) to authenticated;
grant execute on function public.inventory_record_retail_sale_with_unit(uuid, text, numeric, text, numeric, date, text) to authenticated;

notify pgrst, 'reload schema';
commit;
