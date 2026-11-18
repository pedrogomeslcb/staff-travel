-- Staff Planner: discover return transfers by date + departure airport.
-- Fix for requests where Hotel is no longer an editable field and is stored
-- internally as "Not specified". Run after shared-transfer-pickups.sql.
-- Only active matching pickups are exposed. No confirmation, loyalty, notes,
-- full itinerary, or other personal reservation details are returned.

create or replace function public.staff_transfer_pickup_options_v2(
  p_day date,
  p_airport text
)
returns table (
  pickup_time text,
  requested_by text,
  pickup_location text,
  driver_ids text[],
  assigned_driver text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  searched_airport text := upper(btrim(coalesce(p_airport, '')));
begin
  if actor is null or not exists (
    select 1 from public.staff_profiles p
    where p.user_id = actor and p.role in ('admin', 'user')
  ) then
    raise exception 'Registered staff access required' using errcode = '42501';
  end if;

  if p_day is null or char_length(searched_airport) not between 2 and 12 then
    return;
  end if;

  return query
  select
    h.record->>'pickupTime' as pickup_time,
    string_agg(
      distinct coalesce(upper(p.username), 'TEAM MEMBER'), ', '
      order by coalesce(upper(p.username), 'TEAM MEMBER')
    ) as requested_by,
    min(btrim(h.record->>'hotel')) as pickup_location,
    coalesce(a.driver_ids, array[]::text[]) as driver_ids,
    max(nullif(h.record->'transfers'->'return'->>'driver', '')) as assigned_driver
  from public.staff_hotel_requests h
  left join public.staff_profiles p on p.user_id = h.owner_user_id
  left join public.staff_transfer_assignments a
    on a.day = p_day
    and a.leg = 'return'
    and a.pickup_time = h.record->>'pickupTime'
    and a.airport = searched_airport
    and a.hotel = lower(btrim(coalesce(h.record->>'hotel', '')))
  where h.owner_user_id <> actor
    and nullif(h.record->>'canceledAt', '') is null
    and h.record->>'pickupDate' = p_day::text
    and upper(btrim(coalesce(h.record->>'returnOrigin', ''))) = searched_airport
    and h.record->>'pickupTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and coalesce(h.record->'transfers'->'return'->>'status', 'to_arrange')
        not in ('canceled', 'completed')
    and btrim(coalesce(h.record->>'hotel', '')) <> ''
  group by
    h.record->>'pickupTime',
    lower(btrim(coalesce(h.record->>'hotel', ''))),
    a.driver_ids
  order by h.record->>'pickupTime';
end;
$$;

revoke all on function public.staff_transfer_pickup_options_v2(date, text)
  from public, anon, authenticated;
grant execute on function public.staff_transfer_pickup_options_v2(date, text)
  to authenticated;
