-- Staff Planner: save an employee's IHG membership when they submit a hotel request.
-- Run AFTER supabase/ihg-by-username.sql and admin-and-hotels.sql.
-- Does not change account permissions or allow one user to edit another's membership.
-- Existing request records are not rewritten.

create or replace function public.staff_sync_ihg_from_hotel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_number text;
begin
  -- Only a user who owns the request can set their own membership via this trigger.
  -- An admin editing someone else's hotel request cannot change that person's IHG.
  if auth.uid() is distinct from new.owner_user_id then return new; end if;

  member_number := btrim(coalesce(new.record->>'membership',''));
  if member_number = '' then return new; end if;
  if char_length(member_number) > 64 then
    raise exception 'IHG membership number must be 64 characters or fewer';
  end if;
  if tg_op = 'UPDATE' then
    if member_number is not distinct from btrim(coalesce(old.record->>'membership','')) then
      return new;
    end if;
  end if;

  insert into public.staff_ihg_memberships (user_id,membership,updated_at)
  values (new.owner_user_id,member_number,now())
  on conflict (user_id) do update
    set membership=excluded.membership,updated_at=excluded.updated_at
    where public.staff_ihg_memberships.membership is distinct from excluded.membership;

  return new;
end;
$$;

revoke all on function public.staff_sync_ihg_from_hotel()
from public, anon, authenticated;

drop trigger if exists staff_hotel_sync_ihg on public.staff_hotel_requests;
create trigger staff_hotel_sync_ihg
after insert or update of record on public.staff_hotel_requests
for each row execute function public.staff_sync_ihg_from_hotel();
