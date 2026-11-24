-- Run once after the hotel, shared transfer and activity log migrations.
-- Installation does not archive any trips.
begin;

-- Match the group identity used by the Transfers screen.
create or replace function public.staff_archive_slots(r jsonb)
returns setof jsonb language sql immutable set search_path='' as $$
  select jsonb_build_array(r->>'outDate',r->>'outTime','arrival',upper(trim(r->>'outDestination')),'',null)
  union all
  select jsonb_build_array(r->>'pickupDate',r->>'pickupTime','return',upper(trim(r->>'returnOrigin')),
    lower(regexp_replace(trim(r->>'hotel'),'[[:space:]]+',' ','g')),null)
$$;
revoke all on function public.staff_archive_slots(jsonb) from public, anon, authenticated;

-- Direct client writes cannot create or modify summaries. The admin RPC owns the transition.
drop policy if exists staff_archive_update_guard on public.staff_hotel_requests;
create policy staff_archive_update_guard on public.staff_hotel_requests as restrictive for update to authenticated
using (not (record ? 'archivedAt')) with check (not (record ? 'archivedAt'));
drop policy if exists staff_archive_insert_guard on public.staff_hotel_requests;
create policy staff_archive_insert_guard on public.staff_hotel_requests as restrictive for insert to authenticated
with check (not (record ? 'archivedAt'));

drop trigger if exists staff_hotel_audit on public.staff_hotel_requests;
create trigger staff_hotel_audit after insert or update on public.staff_hotel_requests
for each row when (not (new.record ? 'archivedAt')) execute function public.staff_log_hotel_activity();

create or replace function public.staff_trip_archive(saved_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cutoff text:=to_char((now() at time zone 'UTC')::date-30,'YYYY-MM-DD');
  archive jsonb;
  version_code text;
  changed integer;
begin
  if auth.uid() is null or public.is_staff_admin() is not true then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if saved_version is not null then
    lock table public.staff_hotel_requests, public.staff_transfer_assignments in share row exclusive mode;
    lock table public.drivers in share mode;
  end if;
  with eligible as (
    select h.record from public.staff_hotel_requests h
    where not (h.record ? 'archivedAt') and h.record->>'checkout' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and h.record->>'checkout' <= cutoff
  ), slots as (
    select distinct s.key from eligible e cross join lateral public.staff_archive_slots(e.record) s(key)
  ), assignments as (
    select a.* from public.staff_transfer_assignments a join slots s on a.slot_key::jsonb=s.key
  ), used_drivers as (
    select unnest(a.driver_ids) as id from assignments a
    union select e.record#>>'{transfers,arrival,driverId}' from eligible e
    union select e.record#>>'{transfers,return,driverId}' from eligible e
  )
  select jsonb_build_object('format','staff-planner-trips','version',1,
    'trips',coalesce((select jsonb_agg(record order by record->>'id') from eligible),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.slot_key) from assignments a),'[]'::jsonb),
    'drivers',coalesce((select jsonb_agg(to_jsonb(d) order by d.name) from public.drivers d
      where lower(d.name) in (select id from used_drivers)),'[]'::jsonb))
  into archive;
  version_code:=md5(archive::text);
  if saved_version is null then
    return jsonb_build_object('archive',archive,'versionCode',version_code);
  end if;
  if saved_version<>version_code then
    raise exception 'The archive data changed. Download a fresh copy before confirming.';
  end if;
  update public.staff_hotel_requests h set revision=h.revision+1,
    record=jsonb_build_object('id',h.id,'userId',h.owner_user_id,'person',h.record->'person',
      'checkin',h.record->'checkin','checkout',h.record->'checkout','outDate',h.record->'outDate',
      'returnDate',h.record->'returnDate','canceledAt',h.record->'canceledAt','archivedAt',now(),'revision',h.revision+1)
    from jsonb_array_elements(archive->'trips') t where h.id=(t->>'id')::uuid;
  get diagnostics changed=row_count;
  delete from public.staff_transfer_assignments a using jsonb_array_elements(archive->'assignments') x
  where a.slot_key=x->>'slot_key' and not exists (
    select 1 from public.staff_hotel_requests h cross join lateral public.staff_archive_slots(h.record) s(key)
    where not (h.record ? 'archivedAt') and s.key=a.slot_key::jsonb
  );
  return jsonb_build_object('count',changed);
end;
$$;
revoke all on function public.staff_trip_archive(text) from public,anon;
grant execute on function public.staff_trip_archive(text) to authenticated;
commit;
