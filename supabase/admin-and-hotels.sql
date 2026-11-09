-- Staff & Travel: shared hotel requests, admin directory and owner privileges.
-- Run this SQL once in Supabase SQL Editor. Safe to rerun.
-- Does not store or expose passwords.

alter table public.staff_profiles
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists is_primary_admin boolean not null default false;

-- Backfill names and usernames for existing accounts.
update public.staff_profiles p
set username = coalesce(p.username, lower(split_part(u.email, '@', 1))),
    display_name = coalesce(nullif(p.display_name, ''), p.staff_code, split_part(u.email, '@', 1))
from auth.users u
where u.id = p.user_id;

-- The only currently designated primary administrator is the existing email-based Admin.
-- If there are already several email-based admins, select the intended owner manually.
update public.staff_profiles
set is_primary_admin = true
where user_id = (
  select p.user_id
  from public.staff_profiles p
  join auth.users u on u.id = p.user_id
  where p.role = 'admin'
    and u.email not like '%@users.staff-travel.example.com'
  order by u.created_at asc
  limit 1
)
and not exists (select 1 from public.staff_profiles where is_primary_admin = true);

create unique index if not exists staff_profiles_unique_username
  on public.staff_profiles (lower(username))
  where username is not null;

-- Re-registering does not grant admin status.
create or replace function public.create_staff_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  handle text;
  fullname text;
begin
  if lower(split_part(coalesce(new.email, ''), '@', 2)) = 'users.staff-travel.example.com' then
    handle := lower(split_part(new.email, '@', 1));
    fullname := left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);
    if fullname = '' then fullname := handle; end if;

    insert into public.staff_profiles
      (user_id, role, staff_code, display_name, username, is_primary_admin)
    values (new.id, 'user', null, fullname, handle, false)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Allow admins to read profiles but never edit role/owner flags using the client API.
drop policy if exists profiles_admin_write on public.staff_profiles;
drop policy if exists profiles_read on public.staff_profiles;
create policy profiles_read on public.staff_profiles
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_staff_admin()));

-- Only the authenticated account with is_primary_admin=true has owner privileges.
create or replace function public.is_staff_primary_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = (select auth.uid())
      and role = 'admin' and is_primary_admin = true
  );
$$;
revoke all on function public.is_staff_primary_admin() from public, anon, authenticated;
grant execute on function public.is_staff_primary_admin() to authenticated;

-- Hotel requests stay available to admins after a user's account is removed.
-- No FK to auth.users: deleting an account must not erase historical bookings.
create table if not exists public.staff_hotel_requests (
  id uuid primary key,
  owner_user_id uuid not null,
  record jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_request_record_object check (jsonb_typeof(record) = 'object'),
  constraint hotel_request_positive_revision check (revision >= 1)
);
create index if not exists staff_hotels_owner_idx
  on public.staff_hotel_requests(owner_user_id);
create index if not exists staff_hotels_updated_idx
  on public.staff_hotel_requests(updated_at desc);
alter table public.staff_hotel_requests enable row level security;
revoke all on public.staff_hotel_requests from anon;
grant select, insert, update on public.staff_hotel_requests to authenticated;

drop policy if exists hotel_read on public.staff_hotel_requests;
create policy hotel_read on public.staff_hotel_requests
for select to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_staff_admin()));

drop policy if exists hotel_insert on public.staff_hotel_requests;
create policy hotel_insert on public.staff_hotel_requests
for insert to authenticated
with check (
  owner_user_id = (select auth.uid())
  and exists (select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid()) and p.role in ('admin','user'))
);

drop policy if exists hotel_update on public.staff_hotel_requests;
create policy hotel_update on public.staff_hotel_requests
for update to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_staff_admin()))
with check (owner_user_id = (select auth.uid()) or (select public.is_staff_admin()));

-- Server-side invariants: ownership cannot be reassigned, revisions must increase,
-- and only admins can modify requested status or transfer assignments.
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
    if new.owner_user_id is distinct from actor or new.revision <> 1
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
drop trigger if exists staff_hotel_validate on public.staff_hotel_requests;
create trigger staff_hotel_validate
before insert or update on public.staff_hotel_requests
for each row execute function public.validate_staff_hotel_change();

-- Verify primary administrator assignment (result must show one true).
select username, display_name, role, is_primary_admin
from public.staff_profiles
where role = 'admin'
order by is_primary_admin desc, username;
