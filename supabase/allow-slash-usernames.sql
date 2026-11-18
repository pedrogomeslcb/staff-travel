-- Staff & Travel: allow uppercase P/GOM-style usernames on an existing project.
-- Run in Supabase SQL Editor. Safe to rerun. No team-code or password changes.
-- Supabase Auth email identifiers remain lowercase internally; displayed and
-- stored profile usernames are uppercase.

create or replace function public.validate_staff_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_hash text;
  supplied_code text;
  handle text;
begin
  if lower(split_part(coalesce(new.email, ''), '@', 2))
     = 'users.staff-travel.example.com' then

    handle := lower(split_part(new.email, '@', 1));

    if handle !~ '^[a-z0-9][a-z0-9._/-]{1,31}$'
       or handle in ('admin', 'root', 'system', 'support') then
      raise exception 'Invalid or reserved username';
    end if;

    select access_code_sha256
      into expected_hash
      from public.staff_signup_settings
     where id = 1;

    supplied_code := coalesce(new.raw_user_meta_data ->> 'team_access_code', '');

    if expected_hash is null
       or encode(sha256(convert_to(supplied_code, 'UTF8')), 'hex') <> expected_hash then
      raise exception 'Invalid team access code';
    end if;

    -- Do not store the access code in user metadata.
    new.raw_user_meta_data :=
      coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'team_access_code';
  end if;

  return new;
end;
$$;

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
    values (new.id, 'user', null, fullname, upper(handle), false)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Normalize usernames in the profile table, preserving logins and membership links.
update public.staff_profiles
set username = upper(username)
where username is not null and username <> upper(username);
