-- Allow authenticated admins to edit other registered team members' Schedule.
-- Run AFTER supabase/shared-schedule.sql in Supabase SQL Editor.
-- Replaces only the existing staff_schedule_apply JSONB RPC. Safe to rerun.
-- Non-admins continue to modify only their own dates; the primary admin
-- cannot be selected as someone else's target.

create or replace function public.staff_schedule_apply(changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target uuid := auth.uid();
  target_text text;
  actor_role text;
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

  -- A targetUserId is optional. Omitted means edit only your own dates.
  -- Admins may target other registered employees, except the primary
  -- administrator (who is intentionally excluded from the team roster).
  target_text := changes->0->>'targetUserId';
  if target_text is not null then
    begin
      target := target_text::uuid;
    exception when others then
      raise exception 'Invalid target team member';
    end;
  end if;
  if target is distinct from actor then
    select role into actor_role from public.staff_profiles where user_id=actor;
    if actor_role is distinct from 'admin' then
      raise exception 'Only admins may edit a colleague''s Schedule'
        using errcode='42501';
    end if;
  end if;
  if not exists (
    select 1 from public.staff_profiles p
    where p.user_id=target and p.role in ('admin','user')
      and (p.is_primary_admin=false or target=actor)
  ) then
    raise exception 'Target team member not found or cannot be edited'
      using errcode='42501';
  end if;

  -- Serialize concurrent edits to the same team member, regardless of editor.
  perform pg_advisory_xact_lock(hashtextextended(target::text, 0));

  -- Validate everything before modifying any row: one atomic save.
  for change in select value from jsonb_array_elements(changes)
  loop
    if jsonb_typeof(change) <> 'object' then
      raise exception 'Invalid schedule change';
    end if;
    date_string := change->>'date';
    requested := change->>'status';
    if (change ? 'targetUserId') and change->>'targetUserId' is distinct from target::text then
      raise exception 'All changes must target the same team member';
    end if;

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
    where s.user_id=target and s.day=day_value;

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
      where user_id=target and day=day_value;
    else
      insert into public.staff_schedule_entries(user_id,day,status,updated_at)
      values (target,day_value,requested,now())
      on conflict (user_id,day)
      do update set status=excluded.status,updated_at=excluded.updated_at;
    end if;
  end loop;

  return jsonb_build_object('previous',previous_values);
end;
$$;
