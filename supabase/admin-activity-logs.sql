-- Staff & Travel: durable administrator-only activity logs.
-- Install after admin-and-hotels.sql. To capture Schedule and IHG edits,
-- install shared-schedule.sql and ihg-by-username.sql first.
-- Only changes occurring AFTER this migration are captured.
-- No passwords, team access codes, IHG numbers, or full reservation records are logged.

create table if not exists public.staff_activity_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  actor_user_id uuid,
  actor_name text not null,
  subject_user_id uuid,
  subject_name text not null,
  details jsonb not null default '{}'::jsonb
);
create index if not exists staff_activity_logs_created_idx
  on public.staff_activity_logs (created_at desc, id desc);

alter table public.staff_activity_logs enable row level security;
revoke all on public.staff_activity_logs from public, anon, authenticated;
grant select on public.staff_activity_logs to authenticated;

drop policy if exists staff_activity_admin_read on public.staff_activity_logs;
create policy staff_activity_admin_read on public.staff_activity_logs
for select to authenticated
using ((select public.is_staff_admin()));

-- Trigger-only writer. Ordinary browser clients cannot call or insert audit records.
create or replace function public.staff_append_activity(
  event_kind text, target_id uuid, target_name text, payload jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  writer_id uuid := auth.uid();
  writer_name text;
begin
  if writer_id is not null then
    select coalesce(nullif(display_name, ''), nullif(upper(username), ''), 'Team member')
      into writer_name
    from public.staff_profiles where user_id = writer_id;
  end if;
  insert into public.staff_activity_logs
    (kind, actor_user_id, actor_name, subject_user_id, subject_name, details)
  values
    (event_kind, writer_id,
     coalesce(writer_name, 'System / administrator'),
     target_id, coalesce(nullif(target_name, ''), 'Team member'),
     coalesce(payload, '{}'::jsonb));
end;
$$;
revoke all on function public.staff_append_activity(text,uuid,text,jsonb)
from public, anon, authenticated;

-- Capture hotel creation, edits, confirmation, requests, cancellation, and transfers.
create or replace function public.staff_log_hotel_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text;
  alterations jsonb := '[]'::jsonb;
  field_key text;
  field_label text;
  target_name text;
begin
  if tg_op = 'UPDATE' then
    if new.record is not distinct from old.record then return new; end if;
  end if;
  if tg_op = 'INSERT' then
    kind := 'hotel_created';
  elsif nullif(new.record->>'canceledAt','') is distinct from nullif(old.record->>'canceledAt','') then
    kind := 'hotel_canceled';
  elsif new.record->>'hotelCancellationNotifiedAt' is distinct from old.record->>'hotelCancellationNotifiedAt' then
    kind := 'hotel_notified';
  elsif new.record->>'hotelRequested' is distinct from old.record->>'hotelRequested' then
    kind := case when new.record->>'hotelRequested' = 'true' then 'hotel_requested' else 'hotel_unrequested' end;
  elsif new.record->>'confirmationNumber' is distinct from old.record->>'confirmationNumber' then
    kind := 'hotel_confirmed';
  elsif new.record->'transfers' is distinct from old.record->'transfers' then
    kind := 'transfer_updated';
  else
    kind := 'hotel_edited';
  end if;

  if tg_op = 'UPDATE' then
    for field_key,field_label in
      select * from (values
        ('project','Project'), ('hotel','Hotel'), ('checkin','Check-in'), ('checkout','Check-out'),
        ('outFlight','Arrival flight'),('outOrigin','Arrival origin'),
        ('outDestination','Arrival airport'),('outDate','Arrival date'),('outTime','Arrival time'),
        ('returnFlight','Return flight'),('returnOrigin','Return origin'),
        ('returnDestination','Return destination'),('returnDate','Departure date'),
        ('returnTime','Departure time'),('pickupDate','Hotel pickup date'),('pickupTime','Hotel pickup time')
      ) as fields(key,label)
    loop
      if new.record->>field_key is distinct from old.record->>field_key then
        alterations := alterations || jsonb_build_array(jsonb_build_object(
          'label',field_label,'before',old.record->>field_key,'after',new.record->>field_key));
      end if;
    end loop;
    if new.record->>'notes' is distinct from old.record->>'notes' then
      alterations := alterations || '[{"label":"Comments"}]'::jsonb;
    end if;
    if new.record->>'membership' is distinct from old.record->>'membership' then
      alterations := alterations || '[{"label":"Hotel loyalty number"}]'::jsonb;
    end if;
    if kind = 'transfer_updated' then
      alterations := alterations || '[{"label":"Transfer assignment or status"}]'::jsonb;
    end if;
    if kind = 'hotel_confirmed' then
      alterations := alterations || '[{"label":"Confirmation number"}]'::jsonb;
    end if;
  end if;

  select display_name into target_name
    from public.staff_profiles where user_id = new.owner_user_id;
  perform public.staff_append_activity(kind,new.owner_user_id,
    coalesce(target_name,new.record->>'person'),
    jsonb_build_object(
      'trip',jsonb_build_object(
        'hotel',new.record->>'hotel', 'project',new.record->>'project',
        'checkin',new.record->>'checkin','checkout',new.record->>'checkout'),
      'changes',alterations,
      'hotelNotificationRequired',new.record->>'hotelCancellationRequired' = 'true'));
  return new;
end;
$$;

-- Capture shared schedule changes, including undo and local schedule imports.
create or replace function public.staff_log_schedule_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid;
  day_value date;
  before_status text;
  after_status text;
  target_name text;
begin
  if tg_op = 'DELETE' then
    account_id := old.user_id;day_value := old.day;before_status := old.status;after_status := null;
  else
    account_id := new.user_id;day_value := new.day;after_status := new.status;
    before_status := case when tg_op = 'INSERT' then null else old.status end;
  end if;
  if before_status is not distinct from after_status then return null; end if;
  select display_name into target_name from public.staff_profiles where user_id = account_id;
  perform public.staff_append_activity('schedule_changed',account_id,target_name,
    jsonb_build_object('days',jsonb_build_array(jsonb_build_object(
      'date',day_value::text,'before',before_status,'after',after_status))));
  return null;
end;
$$;

-- Capture profile creation, deletion, changes in role, department and display name.
-- Profile updates via service-role Edge Functions are attributed to System / administrator,
-- because those service-role requests do not carry an end-user auth.uid().
create or replace function public.staff_log_profile_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  alterations jsonb := '[]'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.staff_append_activity('user_created',new.user_id,new.display_name,'{}'::jsonb);
  elsif tg_op = 'DELETE' then
    perform public.staff_append_activity('user_deleted',old.user_id,old.display_name,'{}'::jsonb);
  else
    if old.display_name is distinct from new.display_name then
      alterations := alterations || jsonb_build_array(jsonb_build_object(
        'label','Name','before',old.display_name,'after',new.display_name));
    end if;
    if old.role is distinct from new.role then
      alterations := alterations || jsonb_build_array(jsonb_build_object(
        'label','Role','before',old.role,'after',new.role));
    end if;
    if to_jsonb(old)->>'department' is distinct from to_jsonb(new)->>'department' then
      alterations := alterations || jsonb_build_array(jsonb_build_object(
        'label','Department','before',to_jsonb(old)->>'department','after',to_jsonb(new)->>'department'));
    end if;
    if upper(coalesce(old.username,'')) is distinct from upper(coalesce(new.username,'')) then
      alterations := alterations || jsonb_build_array(jsonb_build_object(
        'label','Username','before',upper(old.username),'after',upper(new.username)));
    end if;
    if jsonb_array_length(alterations)>0 then
      perform public.staff_append_activity('user_updated',new.user_id,new.display_name,
        jsonb_build_object('changes',alterations));
    end if;
  end if;
  return null;
end;
$$;

-- IHG values are NEVER logged; only that the membership entry changed.
create or replace function public.staff_log_ihg_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid;
  target_name text;
begin
  account_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if tg_op = 'UPDATE' then
    if old.membership is not distinct from new.membership then return null; end if;
  end if;
  select display_name into target_name from public.staff_profiles where user_id=account_id;
  perform public.staff_append_activity('membership_updated',account_id,target_name,
    '{"changes":[{"label":"IHG membership"}]}'::jsonb);
  return null;
end;
$$;

-- Install triggers only for tables present in the existing project.
do $$
begin
  if to_regclass('public.staff_hotel_requests') is not null then
    execute 'drop trigger if exists staff_hotel_audit on public.staff_hotel_requests';
    execute 'create trigger staff_hotel_audit after insert or update on public.staff_hotel_requests for each row execute function public.staff_log_hotel_activity()';
  end if;
  if to_regclass('public.staff_schedule_entries') is not null then
    execute 'drop trigger if exists staff_schedule_audit on public.staff_schedule_entries';
    execute 'create trigger staff_schedule_audit after insert or update or delete on public.staff_schedule_entries for each row execute function public.staff_log_schedule_activity()';
  end if;
  if to_regclass('public.staff_profiles') is not null then
    execute 'drop trigger if exists staff_profiles_audit on public.staff_profiles';
    execute 'create trigger staff_profiles_audit after insert or update or delete on public.staff_profiles for each row execute function public.staff_log_profile_activity()';
  end if;
  if to_regclass('public.staff_ihg_memberships') is not null then
    execute 'drop trigger if exists staff_ihg_audit on public.staff_ihg_memberships';
    execute 'create trigger staff_ihg_audit after insert or update or delete on public.staff_ihg_memberships for each row execute function public.staff_log_ihg_activity()';
  end if;
end;
$$;
