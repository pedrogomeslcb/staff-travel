create or replace function public.staff_schedule_presence_v2()
returns table (
  user_id uuid,
  checkin text,
  checkout text,
  arrival_day text,
  departure_day text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.staff_profiles p
    where p.user_id=(select auth.uid())
      and p.role in ('admin','user')
  ) then
    raise exception 'A registered staff login is required'
      using errcode='42501';
  end if;

  return query
    select h.owner_user_id,
           h.record->>'checkin',
           h.record->>'checkout',
           h.record->>'outDate', h.record->>'returnDate'
    from public.staff_hotel_requests h
    join public.staff_profiles p on p.user_id=h.owner_user_id
    where p.is_primary_admin=false
      and nullif(h.record->>'canceledAt','') is null
      and h.record->>'checkin' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and h.record->>'checkout' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
end;
$$;

revoke all on function public.staff_schedule_presence_v2()
  from public, anon;
grant execute on function public.staff_schedule_presence_v2()
  to authenticated;
