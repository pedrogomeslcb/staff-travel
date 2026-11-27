-- Run once after trip-archive.sql and admin-activity-logs.sql.
-- Installing this migration does not delete anything.
begin;
create or replace function public.staff_delete_canceled_hotel(p_id uuid,p_revision integer,p_acknowledge boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  booking public.staff_hotel_requests%rowtype;
begin
  if auth.uid() is null or public.is_staff_admin() is not true then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  -- Same lock order as the archive operation; keep shared transfer slots intact.
  lock table public.staff_hotel_requests, public.staff_transfer_assignments in share row exclusive mode;
  select * into booking from public.staff_hotel_requests where id=p_id for update;
  if not found then raise exception 'Request not found. Refresh and try again.'; end if;
  if booking.revision is distinct from p_revision then
    raise exception 'This request changed elsewhere. Refresh and try again.';
  end if;
  if nullif(booking.record->>'canceledAt','') is null or nullif(booking.record->>'archivedAt','') is not null then
    raise exception 'Only canceled, non-archived requests can be permanently deleted.';
  end if;
  if booking.record->>'hotelCancellationRequired'='true'
    and nullif(booking.record->>'hotelCancellationNotifiedAt','') is null
    and p_acknowledge is not true then
    raise exception 'Confirm that no hotel cancellation notice is outstanding.';
  end if;
  delete from public.staff_hotel_requests where id=p_id;
  -- Remove only allocations belonging exclusively to this deleted request.
  -- Other trips, including canceled trips retained for archive, keep their slots.
  delete from public.staff_transfer_assignments a
  where exists (select 1 from public.staff_archive_slots(booking.record) s(key) where s.key=a.slot_key::jsonb)
    and not exists (
      select 1 from public.staff_hotel_requests h
      cross join lateral public.staff_archive_slots(h.record) s(key)
      where nullif(h.record->>'archivedAt','') is null and s.key=a.slot_key::jsonb
    );
  perform public.staff_append_activity('hotel_deleted',booking.owner_user_id,booking.record->>'person',
    jsonb_build_object('trip',jsonb_build_object('checkin',booking.record->>'checkin','checkout',booking.record->>'checkout'),
      'changes',jsonb_build_array(jsonb_build_object('label','Canceled request permanently deleted'))));
  return jsonb_build_object('id',p_id);
end;
$$;
revoke all on function public.staff_delete_canceled_hotel(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.staff_delete_canceled_hotel(uuid,integer,boolean) to authenticated;
commit;
