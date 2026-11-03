begin;

do $$
begin
  if exists (
    select 1
    from app_private.applied_data_migrations
    where migration_name = '202611030002_require_explicit_buyer_completion'
  ) then
    raise exception '202611030002_require_explicit_buyer_completion has already been applied.';
  end if;
end;
$$;

delete from public.business_day_buyer_progress as progress
using public.business_day_workflow_settings as settings
where settings.singleton
  and progress.sale_date = settings.start_date;

insert into app_private.applied_data_migrations(migration_name)
values ('202611030002_require_explicit_buyer_completion');

notify pgrst, 'reload schema';
commit;
