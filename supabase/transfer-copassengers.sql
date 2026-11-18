-- Staff Planner: expose only the people sharing the signed-in user's transfers.
-- Run after admin-and-hotels.sql. Safe to rerun.
-- Does not grant direct access to another team member's hotel booking or membership.

create or replace function public.staff_transfer_copassengers()
returns table (
  trip_id text,
  user_id uuid,
  person text,
  leg text,
  transfer_day text,
  transfer_time text,
  airport text,
  hotel text,
  flight text
)
language plpgsql stable security definer set search_path=''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1 from public.staff_profiles p
    where p.user_id=actor and p.role in ('user','admin')
  ) then
    raise exception 'Registered staff access required' using errcode='42501';
  end if;

  return query
  with own_slots as (
    select distinct l.direction,l.day,l.hour,l.port,l.hotel_name
    from public.staff_hotel_requests h
    cross join lateral (
      values
        ('arrival',h.record->>'outDate',h.record->>'outTime',
          upper(btrim(coalesce(h.record->>'outDestination',''))),''),
        ('return',h.record->>'pickupDate',h.record->>'pickupTime',
          upper(btrim(coalesce(h.record->>'returnOrigin',''))),
          lower(btrim(coalesce(h.record->>'hotel',''))))
    ) as l(direction,day,hour,port,hotel_name)
    where h.owner_user_id=actor
      and nullif(h.record->>'canceledAt','') is null
      and coalesce(h.record->'transfers'->l.direction->>'status','to_arrange')<>'canceled'
      and l.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and l.hour ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and l.port<>''
  )
  select distinct
    h.id::text||'-'||l.direction,
    h.owner_user_id,
    coalesce(nullif(p.display_name,''),upper(p.username),'Team member'),
    l.direction,l.day,l.hour,l.port,
    case when l.direction='return' then h.record->>'hotel' else '' end,
    case when l.direction='return' then h.record->>'returnFlight'
      else h.record->>'outFlight' end
  from public.staff_hotel_requests h
  join public.staff_profiles p on p.user_id=h.owner_user_id
  cross join lateral (
    values
      ('arrival',h.record->>'outDate',h.record->>'outTime',
        upper(btrim(coalesce(h.record->>'outDestination',''))),''),
      ('return',h.record->>'pickupDate',h.record->>'pickupTime',
        upper(btrim(coalesce(h.record->>'returnOrigin',''))),
        lower(btrim(coalesce(h.record->>'hotel',''))))
  ) as l(direction,day,hour,port,hotel_name)
  join own_slots own on own.direction=l.direction and own.day=l.day
    and own.hour=l.hour and own.port=l.port
    and (l.direction='arrival' or own.hotel_name=l.hotel_name)
  where h.owner_user_id<>actor
    and p.is_primary_admin=false
    and nullif(h.record->>'canceledAt','') is null
    and coalesce(h.record->'transfers'->l.direction->>'status','to_arrange')<>'canceled'
  order by 5,6,4,3;
end;
$$;

revoke all on function public.staff_transfer_copassengers()
  from public, anon, authenticated;
grant execute on function public.staff_transfer_copassengers()
  to authenticated;
