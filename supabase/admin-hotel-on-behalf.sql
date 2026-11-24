-- Enable admins to create a hotel request for an existing team member.
-- Run once in Supabase SQL Editor after admin-and-hotels.sql.
-- Safe to rerun. Existing hotel requests and ownership are preserved.
begin;

drop policy if exists hotel_insert on public.staff_hotel_requests;
create policy hotel_insert on public.staff_hotel_requests
for insert to authenticated
with check (
  (owner_user_id = (select auth.uid()) or (select public.is_staff_admin()))
  and exists (select 1 from public.staff_profiles p
    where p.user_id = owner_user_id and p.role in ('admin','user'))
);

create or replace function public.validate_staff_hotel_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  actor uuid := auth.uid();
  actor_is_admin boolean := public.is_staff_admin();
begin
  if actor is null then raise exception 'Authentication required'; end if;

  if new.record->>'id' is distinct from new.id::text
     or new.record->>'userId' is distinct from new.owner_user_id::text then
    raise exception 'Hotel request owner or ID mismatch';
  end if;

  if tg_op = 'INSERT' then
    if (new.owner_user_id is distinct from actor and not actor_is_admin) or new.revision <> 1
       or (new.record->>'hotelRequested') = 'true'
       or coalesce(new.record->>'confirmationNumber','') <> '' then
      raise exception 'Invalid initial hotel request';
    end if;
    new.created_at := now();
  else
    if old.owner_user_id is distinct from new.owner_user_id
       or old.id is distinct from new.id
       or new.revision <> old.revision + 1 then
      raise exception 'Hotel request cannot change owner; revisions must increase by one';
    end if;
    if not actor_is_admin then
      if new.record->'transfers' is distinct from old.record->'transfers'
         or new.record->'hotelRequested' is distinct from old.record->'hotelRequested'
         or new.record->'hotelRequestedAt' is distinct from old.record->'hotelRequestedAt'
         or new.record->'hotelRequestedBy' is distinct from old.record->'hotelRequestedBy'
         or new.record->'hotelCancellationNotifiedAt' is distinct from old.record->'hotelCancellationNotifiedAt'
         or new.record->'hotelCancellationNotifiedBy' is distinct from old.record->'hotelCancellationNotifiedBy' then
        raise exception 'Only admins may modify hotel requested status and transfers';
      end if;
    end if;
  end if;

  if (new.record->>'revision')::integer is distinct from new.revision then
    raise exception 'Hotel request revision mismatch';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
commit;
