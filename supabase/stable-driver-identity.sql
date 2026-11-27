-- Run once in the Supabase SQL Editor as the project owner.
-- Preserve the existing jos/vla/ota identifiers and all transfer allocations.
-- Existing RLS and table grants are unchanged; driver IDs cannot be changed by edits.
begin;
lock table public.drivers in access exclusive mode;
alter table public.drivers add column if not exists driver_id text;
update public.drivers
set driver_id=regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '-', 'g')
where driver_id is null;
-- Fail atomically if existing names do not map unambiguously to identifiers.
alter table public.drivers alter column driver_id set not null;
create unique index if not exists drivers_stable_id_unique on public.drivers(driver_id);
create unique index if not exists drivers_display_name_unique on public.drivers(lower(btrim(name)));

create or replace function public.staff_preserve_driver_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.driver_id := regexp_replace(lower(btrim(new.name)), '[^a-z0-9]+', '-', 'g');
    if new.driver_id is null or new.driver_id='' then
      raise exception 'Enter a valid driver name';
    end if;
  elsif new.driver_id is distinct from old.driver_id then
    raise exception 'Driver identifier cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists staff_driver_identity on public.drivers;
create trigger staff_driver_identity before insert or update on public.drivers
for each row execute function public.staff_preserve_driver_identity();

-- Log changes using the existing admin-only, trigger-written audit table.
-- Phone numbers and plates are not duplicated in historical logs.
create or replace function public.staff_log_driver_activity()
returns trigger language plpgsql security definer set search_path='' as $$
declare changes jsonb := '[]'::jsonb;
begin
  if tg_op='UPDATE' then
    if new.name is distinct from old.name then
      changes := changes || jsonb_build_array(jsonb_build_object('label','Driver name','before',old.name,'after',new.name));
    end if;
    if new.license_plate is distinct from old.license_plate then
      changes := changes || '[{"label":"License plate"}]'::jsonb;
    end if;
    if new.contact is distinct from old.contact then
      changes := changes || '[{"label":"Contact"}]'::jsonb;
    end if;
    if changes='[]'::jsonb then return new; end if;
  end if;
  if to_regprocedure('public.staff_append_activity(text,uuid,text,jsonb)') is not null then
    perform public.staff_append_activity(case when tg_op='INSERT' then 'driver_created' else 'driver_updated' end,
      null,new.name,jsonb_build_object('changes',changes));
  end if;
  return new;
end;
$$;
revoke all on function public.staff_log_driver_activity() from public, anon, authenticated;
drop trigger if exists staff_driver_audit on public.drivers;
create trigger staff_driver_audit after insert or update on public.drivers
for each row execute function public.staff_log_driver_activity();
commit;
