-- Staff & Travel: self-registration with username, password and a team access code.
-- Run this script ONCE in Supabase SQL Editor.
-- IMPORTANT: replace the phrase below with your own private team access code.
-- Share the code only with legitimate staff. Never put the code into GitHub source.

create table if not exists public.staff_signup_settings (
  id integer primary key check (id=1),
  access_code_sha256 text not null check (access_code_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.staff_signup_settings enable row level security;
revoke all on table public.staff_signup_settings from public, anon, authenticated;

-- IMPORTANT: replace TROQUE_POR_UM_CODIGO_DA_EQUIPE with a private team access code.
insert into public.staff_signup_settings (id,access_code_sha256)
values (1,encode(sha256(convert_to('TROQUE_POR_UM_CODIGO_DA_EQUIPE','UTF8')),'hex'))
on conflict (id) do update set access_code_sha256=excluded.access_code_sha256;

alter table public.staff_profiles add column if not exists display_name text;

-- Auth signup is validated inside the database, not only in client-side code.
create or replace function public.validate_staff_signup()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  expected_hash text;
  supplied text;
  handle text;
begin
  if lower(split_part(coalesce(new.email,''),'@',2)) = 'users.staff-travel.example.com' then
    handle := lower(split_part(new.email,'@',1));
    if handle !~ '^[a-z0-9][a-z0-9._-]{1,31}
    select access_code_sha256 into expected_hash
      from public.staff_signup_settings where id=1;
    supplied := coalesce(new.raw_user_meta_data->>'team_access_code','');
    if expected_hash is null or
       encode(sha256(convert_to(supplied,'UTF8')),'hex') <> expected_hash then
      raise exception 'Invalid team access code';
    end if;
    -- Do not retain the access code in the user's editable metadata.
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data,'{}'::jsonb) - 'team_access_code';
  end if;
  return new;
end;
$$;

drop trigger if exists before_staff_signup on auth.users;
create trigger before_staff_signup
before insert on auth.users
for each row execute function public.validate_staff_signup();

-- Assign only the least privileged role to self-registered accounts.
-- Membership codes and admin privileges are never accepted from signup metadata.
create or replace function public.create_staff_profile()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  handle text;
  fullname text;
begin
  if lower(split_part(coalesce(new.email,''),'@',2)) = 'users.staff-travel.example.com' then
    handle := lower(split_part(new.email,'@',1));
    fullname := left(trim(coalesce(new.raw_user_meta_data->>'full_name','')),120);
    if fullname = '' then fullname := handle; end if;
    insert into public.staff_profiles(user_id,role,staff_code,display_name)
      values (new.id,'user',null,fullname)
      on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists after_staff_signup on auth.users;
create trigger after_staff_signup
after insert on auth.users
for each row execute function public.create_staff_profile();

-- Tighten existing read access: only profiled users can read reference tables.
drop policy if exists flights_read on public.flights;
create policy flights_read on public.flights
for select to authenticated
using (exists (
  select 1 from public.staff_profiles p
  where p.user_id=(select auth.uid()) and p.role in ('admin','user')
));

drop policy if exists drivers_read on public.drivers;
create policy drivers_read on public.drivers
for select to authenticated
using (exists (
  select 1 from public.staff_profiles p
  where p.user_id=(select auth.uid()) and p.role in ('admin','user')
));

-- All other existing RLS policies, especially IHG and admin-only edits, remain.
 or
       handle in ('admin','root','system','support') then
      raise exception 'Invalid or reserved username';
    end if;
    select access_code_sha256 into expected_hash
      from public.staff_signup_settings where id=1;
    supplied := coalesce(new.raw_user_meta_data->>'team_access_code','');
    if expected_hash is null or
       encode(sha256(convert_to(supplied,'UTF8')),'hex') <> expected_hash then
      raise exception 'Invalid team access code';
    end if;
    -- Do not retain the access code in the user's editable metadata.
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data,'{}'::jsonb) - 'team_access_code';
  end if;
  return new;
end;
$$;

drop trigger if exists before_staff_signup on auth.users;
create trigger before_staff_signup
before insert on auth.users
for each row execute function public.validate_staff_signup();

-- Assign only the least privileged role to self-registered accounts.
-- Membership codes and admin privileges are never accepted from signup metadata.
create or replace function public.create_staff_profile()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  handle text;
  fullname text;
begin
  if lower(split_part(coalesce(new.email,''),'@',2)) = 'users.staff-travel.example.com' then
    handle := lower(split_part(new.email,'@',1));
    fullname := left(trim(coalesce(new.raw_user_meta_data->>'full_name','')),120);
    if fullname = '' then fullname := handle; end if;
    insert into public.staff_profiles(user_id,role,staff_code,display_name)
      values (new.id,'user',null,fullname)
      on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists after_staff_signup on auth.users;
create trigger after_staff_signup
after insert on auth.users
for each row execute function public.create_staff_profile();

-- Tighten existing read access: only profiled users can read reference tables.
drop policy if exists flights_read on public.flights;
create policy flights_read on public.flights
for select to authenticated
using (exists (
  select 1 from public.staff_profiles p
  where p.user_id=(select auth.uid()) and p.role in ('admin','user')
));

drop policy if exists drivers_read on public.drivers;
create policy drivers_read on public.drivers
for select to authenticated
using (exists (
  select 1 from public.staff_profiles p
  where p.user_id=(select auth.uid()) and p.role in ('admin','user')
));

-- All other existing RLS policies, especially IHG and admin-only edits, remain.
