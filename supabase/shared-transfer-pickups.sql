-- Staff Planner: shared driver allocations and limited matching pickup suggestions.
-- Run AFTER admin-and-hotels.sql and schedule-directory.sql.
-- Never grants ordinary users direct access to another person's booking.

create table if not exists public.staff_transfer_assignments (
  slot_key text primary key check (char_length(slot_key) between 10 and 512),
  day date not null,
  pickup_time text not null check (pickup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  leg text not null check (leg in ('arrival','return')),
  airport text not null check (char_length(airport) between 2 and 12),
  hotel text not null default '',
  driver_ids text[] not null default array[]::text[],
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint allowed_transfer_drivers check (driver_ids <@ array['jos','vla','ota']::text[])
);
create index if not exists staff_transfer_lookup_idx
  on public.staff_transfer_assignments (day,leg,airport,lower(hotel),pickup_time);
alter table public.staff_transfer_assignments enable row level security;
revoke all on public.staff_transfer_assignments from public, anon, authenticated;
grant select on public.staff_transfer_assignments to authenticated;

drop policy if exists staff_transfer_admin_select on public.staff_transfer_assignments;
create policy staff_transfer_admin_select on public.staff_transfer_assignments
for select to authenticated using ((select public.is_staff_admin()));

-- The server verifies the caller's admin role, slot details and optimistic revision.
-- Writes are atomic and the browser cannot insert directly into the table.
create or replace function public.staff_transfer_assign(
  p_key text, p_day date, p_time text, p_leg text,
  p_airport text, p_hotel text, p_driver_ids text[], p_revision integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous integer;
  next_revision integer;
  cleaned_airport text := upper(btrim(coalesce(p_airport,'')));
  cleaned_hotel text := lower(btrim(coalesce(p_hotel,'')));
begin
  if actor is null or not exists (
    select 1 from public.staff_profiles
    where user_id=actor and role='admin'
  ) then raise exception 'Admin access is required' using errcode='42501'; end if;
  if p_key is null or char_length(p_key) not between 10 and 512
    or p_day is null or p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_leg is null or p_leg not in ('arrival','return')
    or char_length(cleaned_airport) not between 2 and 12
    or (p_leg='return' and cleaned_hotel='')
    or p_revision is null or p_revision<0
    or p_driver_ids is null or cardinality(p_driver_ids)>3
    or not (p_driver_ids <@ array['jos','vla','ota']::text[])
    or (select count(distinct value) from unnest(p_driver_ids) as choices(value)) <> cardinality(p_driver_ids) then
    raise exception 'Invalid transfer assignment'; end if;
  if p_leg='arrival' then cleaned_hotel := ''; end if;

  -- Reject fabricated groups: a real active booking must match this pickup.
  if not exists (
    select 1 from public.staff_hotel_requests h
    where nullif(h.record->>'canceledAt','') is null
      and case when p_leg='return' then
        h.record->>'pickupDate'=p_day::text
        and h.record->>'pickupTime'=p_time
        and upper(btrim(h.record->>'returnOrigin'))=cleaned_airport
        and lower(btrim(h.record->>'hotel'))=cleaned_hotel
      else
        h.record->>'outDate'=p_day::text
        and h.record->>'outTime'=p_time
        and upper(btrim(h.record->>'outDestination'))=cleaned_airport
      end
  ) then raise exception 'Transfer group no longer exists'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select revision into previous from public.staff_transfer_assignments
    where slot_key=p_key;
  if coalesce(previous,0)<>p_revision then
    raise exception 'Transfer allocation changed elsewhere. Reload and try again.';
  end if;
  next_revision := p_revision + 1;
  insert into public.staff_transfer_assignments
    (slot_key,day,pickup_time,leg,airport,hotel,driver_ids,revision,updated_at)
  values (p_key,p_day,p_time,p_leg,cleaned_airport,cleaned_hotel,p_driver_ids,next_revision,now())
  on conflict (slot_key) do update
    set driver_ids=excluded.driver_ids,revision=excluded.revision,updated_at=now();
  return jsonb_build_object('key',p_key,'driverIds',to_jsonb(p_driver_ids),'revision',next_revision);
end;
$$;
revoke all on function public.staff_transfer_assign(text,date,text,text,text,text,text[],integer)
from public, anon, authenticated;
grant execute on function public.staff_transfer_assign(text,date,text,text,text,text,text[],integer)
to authenticated;

-- Read allocations for all groups only as an admin, or own groups as a user.
-- Never returns another employee's details.
create or replace function public.staff_transfer_allocations_visible()
returns table (slot_key text,driver_ids text[],revision integer)
language plpgsql stable security definer set search_path=''
as $$
declare
  actor uuid := auth.uid();
  admin_access boolean;
begin
  select role='admin' into admin_access from public.staff_profiles where user_id=actor;
  if actor is null or admin_access is null then
    raise exception 'Registered staff access required' using errcode='42501';
  end if;
  return query
  select a.slot_key,a.driver_ids,a.revision
  from public.staff_transfer_assignments a
  where admin_access or exists (
    select 1 from public.staff_hotel_requests h
    where h.owner_user_id=actor
      and nullif(h.record->>'canceledAt','') is null
      and case when a.leg='return' then
        h.record->>'pickupDate'=a.day::text
        and h.record->>'pickupTime'=a.pickup_time
        and upper(btrim(h.record->>'returnOrigin'))=a.airport
        and lower(btrim(h.record->>'hotel'))=a.hotel
      else
        h.record->>'outDate'=a.day::text
        and h.record->>'outTime'=a.pickup_time
        and upper(btrim(h.record->>'outDestination'))=a.airport
      end
  );
end;
$$;
revoke all on function public.staff_transfer_allocations_visible() from public, anon, authenticated;
grant execute on function public.staff_transfer_allocations_visible() to authenticated;

-- Return ONLY matching future/relevant pickup windows; no booking data.
-- Only usernames, time, and already allocated driver identifiers are returned.
create or replace function public.staff_transfer_pickup_options(
  p_day date,p_airport text,p_hotel text
)
returns table (pickup_time text,requested_by text,driver_ids text[],assigned_driver text)
language plpgsql stable security definer set search_path=''
as $$
declare
  actor uuid := auth.uid();
  searched_airport text := upper(btrim(coalesce(p_airport,'')));
  searched_hotel text := lower(btrim(coalesce(p_hotel,'')));
begin
  if actor is null or not exists (
    select 1 from public.staff_profiles where user_id=actor and role in ('admin','user')
  ) then raise exception 'Registered staff access required' using errcode='42501'; end if;
  if p_day is null or char_length(searched_airport) not between 2 and 12
    or char_length(searched_hotel) not between 2 and 120 then
    return; end if;
  return query
  select h.record->>'pickupTime',
    string_agg(distinct coalesce(upper(p.username),'TEAM MEMBER'),', ' order by coalesce(upper(p.username),'TEAM MEMBER')),
    coalesce(a.driver_ids,array[]::text[]),
    max(nullif(h.record->'transfers'->'return'->>'driver',''))
  from public.staff_hotel_requests h
  left join public.staff_profiles p on p.user_id=h.owner_user_id
  left join public.staff_transfer_assignments a
    on a.day=p_day and a.leg='return'
    and a.pickup_time=h.record->>'pickupTime'
    and a.airport=searched_airport and a.hotel=searched_hotel
  where h.owner_user_id<>actor
    and nullif(h.record->>'canceledAt','') is null
    and h.record->>'pickupDate'=p_day::text
    and upper(btrim(h.record->>'returnOrigin'))=searched_airport
    and lower(btrim(h.record->>'hotel'))=searched_hotel
    and h.record->>'pickupTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and coalesce(h.record->'transfers'->'return'->>'status','to_arrange')
        not in ('canceled','completed')
  group by h.record->>'pickupTime',a.driver_ids
  order by h.record->>'pickupTime';
end;
$$;
revoke all on function public.staff_transfer_pickup_options(date,text,text)
from public, anon, authenticated;
grant execute on function public.staff_transfer_pickup_options(date,text,text)
to authenticated;
