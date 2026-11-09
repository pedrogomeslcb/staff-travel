-- Staff & Travel: shared daily schedule and privacy-scoped hotel presence.
-- Execute once in Supabase SQL Editor. Safe to rerun.
-- Run after admin-and-hotels.sql and schedule-directory.sql.
-- Only the employee edits their own schedule; all registered employees may see
-- schedule statuses and Onsite date ranges for coworkers (never booking details).

create table if not exists public.staff_schedule_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  status text not null
    check (status in ('onsite', 'onsite-half', 'remote', 'offsite-half',
                     'off', 'vacation', 'other', 'blank')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint staff_schedule_weekdays_only
    check (extract(isodow from day) between 1 and 5)
);

create index if not exists staff_schedule_entries_day_idx
  on public.staff_schedule_entries(day);

alter table public.staff_schedule_entries enable row level security;
revoke all on public.staff_schedule_entries from public, anon, authenticated;
grant select on public.staff_schedule_entries to authenticated;

-- RLS: a registered employee can read all manual schedule statuses.
-- No INSERT/UPDATE/DELETE privileges for browser clients: writes go through
-- the validated RPC below, always using auth.uid() as the owner.
drop policy if exists staff_schedule_read on public.staff_schedule_entries;
create policy staff_schedule_read on public.staff_schedule_entries
for select to authenticated
using (
  exists (
    select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid())
      and p.role in ('admin','user')
  )
);

create or replace function public.staff_schedule_apply(changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  total integer;
  change jsonb;
  date_string text;
  day_value date;
  requested text;
  previous_status text;
  expected_status text;
  seen date[] := array[]::date[];
  previous_values jsonb := '[]'::jsonb;
begin
  if actor is null or not exists (
    select 1 from public.staff_profiles p
    where p.user_id = actor and p.role in ('admin','user')
  ) then
    raise exception 'A registered staff login is required'
      using errcode='42501';
  end if;

  if changes is null or jsonb_typeof(changes) <> 'array' then
    raise exception 'Changes must be a list';
  end if;

  total := jsonb_array_length(changes);
  if total < 1 or total > 366 then
    raise exception 'Select between 1 and 366 weekdays to update';
  end if;

  -- Serialize this user's concurrent changes to make optimistic checks reliable.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));

  -- Validate everything before modifying any row: one atomic save.
  for change in select value from jsonb_array_elements(changes)
  loop
    if jsonb_typeof(change) <> 'object' then
      raise exception 'Invalid schedule change';
    end if;
    date_string := change->>'date';
    requested := change->>'status';

    if date_string is null
      or date_string !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or requested is null
      or requested not in ('onsite','onsite-half','remote','offsite-half',
                           'off','vacation','other','blank','clear') then
      raise exception 'Invalid date or schedule category';
    end if;

    begin
      day_value := date_string::date;
    exception when others then
      raise exception 'Invalid schedule date';
    end;

    if to_char(day_value, 'YYYY-MM-DD') <> date_string
       or extract(isodow from day_value) > 5
       or day_value = any(seen) then
      raise exception 'Each weekday can only be changed once';
    end if;
    seen := array_append(seen, day_value);

    select s.status into previous_status
    from public.staff_schedule_entries s
    where s.user_id=actor and s.day=day_value;

    previous_status := coalesce(previous_status, 'clear');
    previous_values := previous_values ||
      jsonb_build_array(jsonb_build_object('date',date_string,'status',previous_status));

    if change ? 'expected' then
      expected_status := change->>'expected';
      if expected_status is distinct from previous_status then
        raise exception 'The schedule changed elsewhere. Reload and try again.'
          using errcode='P0001';
      end if;
    end if;
  end loop;

  for change in select value from jsonb_array_elements(changes)
  loop
    day_value := (change->>'date')::date;
    requested := change->>'status';
    if requested = 'clear' then
      delete from public.staff_schedule_entries
      where user_id=actor and day=day_value;
    else
      insert into public.staff_schedule_entries(user_id,day,status,updated_at)
      values (actor,day_value,requested,now())
      on conflict (user_id,day)
      do update set status=excluded.status,updated_at=excluded.updated_at;
    end if;
  end loop;

  return jsonb_build_object('previous',previous_values);
end;
$$;

revoke all on function public.staff_schedule_apply(jsonb)
  from public, anon;
grant execute on function public.staff_schedule_apply(jsonb)
  to authenticated;

-- A read-only, minimal view of active hotel stays for all schedule viewers.
-- Ordinary staff do not receive hotel names, flights, notes or IHG numbers.
create or replace function public.staff_schedule_presence()
returns table (
  user_id uuid,
  checkin text,
  checkout text
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
           h.record->>'checkout'
    from public.staff_hotel_requests h
    join public.staff_profiles p on p.user_id=h.owner_user_id
    where p.is_primary_admin=false
      and nullif(h.record->>'canceledAt','') is null
      and h.record->>'checkin' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and h.record->>'checkout' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
end;
$$;

revoke all on function public.staff_schedule_presence()
  from public, anon;
grant execute on function public.staff_schedule_presence()
  to authenticated;

-- Optional import: load only the logged-in user's old browser-local entries
-- and only when the corresponding date has no shared entry yet.
-- This function NEVER overwrites an existing shared schedule entry.
create or replace function public.staff_schedule_import(entries jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  entry jsonb;
  date_string text;
  day_value date;
  requested text;
  inserted integer := 0;
  count_row integer;
begin
  if actor is null or not exists (
    select 1 from public.staff_profiles p
    where p.user_id=actor and p.role in ('admin','user')
  ) then
    raise exception 'A registered staff login is required'
      using errcode='42501';
  end if;
  if entries is null or jsonb_typeof(entries)<>'array'
    or jsonb_array_length(entries)>366 then
    raise exception 'Provide up to 366 schedule entries';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));

  for entry in select value from jsonb_array_elements(entries)
  loop
    date_string := entry->>'date';
    requested := entry->>'status';
    if date_string is null or date_string !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or requested not in ('onsite','onsite-half','remote','offsite-half',
                           'off','vacation','other','blank') then
      raise exception 'Invalid local schedule entry';
    end if;
    begin
      day_value := date_string::date;
    exception when others then
      raise exception 'Invalid local schedule date';
    end;
    if to_char(day_value,'YYYY-MM-DD')<>date_string
      or extract(isodow from day_value)>5 then
      raise exception 'Invalid schedule weekday';
    end if;

    insert into public.staff_schedule_entries(user_id,day,status)
    values (actor,day_value,requested)
    on conflict (user_id,day) do nothing;
    get diagnostics count_row = row_count;
    inserted := inserted + count_row;
  end loop;

  return inserted;
end;
$$;

revoke all on function public.staff_schedule_import(jsonb)
  from public, anon;
grant execute on function public.staff_schedule_import(jsonb)
  to authenticated;

-- Check schema; first-time schedule rows appear after a user edits or
-- imports an old schedule. Existing hotel requests supply Onsite defaults.
select table_name
from information_schema.tables
where table_schema='public' and table_name='staff_schedule_entries';
