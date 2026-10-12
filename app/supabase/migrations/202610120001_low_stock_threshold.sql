alter table public.inventory_product_settings
  add column if not exists low_stock_threshold numeric(14, 3) not null default 5
  check (low_stock_threshold >= 0);

drop policy if exists "Authenticated users can update low stock thresholds"
  on public.inventory_product_settings;
create policy "Authenticated users can update low stock thresholds"
  on public.inventory_product_settings for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

grant update (low_stock_threshold) on public.inventory_product_settings to authenticated;

notify pgrst, 'reload schema';
