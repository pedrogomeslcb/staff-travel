-- Staff & Travel: allow automatically generated P/GOM-style usernames.
-- Run once in Supabase SQL Editor on an existing project, BEFORE testing new registrations.
-- Changes only the signup validator. It preserves the existing private team access code,
-- existing accounts, current permissions, and all stored data.

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
