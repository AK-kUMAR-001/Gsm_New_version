begin;

drop function if exists public.inventory_finish_retail_day();

insert into app_private.applied_data_migrations(migration_name)
values ('202610270001_remove_retail_day_finish')
on conflict (migration_name) do nothing;

notify pgrst, 'reload schema';
commit;
