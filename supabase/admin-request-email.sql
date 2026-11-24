-- Run after admin-activity-logs.sql and shared-transfer-pickups.sql.
begin;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists staff_mail;
revoke all on schema staff_mail from public, anon, authenticated;
create table if not exists staff_mail.addresses (
  user_id uuid primary key references public.staff_profiles(user_id) on delete cascade,
  email text not null
);
create table if not exists staff_mail.outbox (
  event_id bigint not null references public.staff_activity_logs(id) on delete cascade,
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  body jsonb, request_id bigint, attempts int not null default 0,
  attempted_at timestamptz, delivered_at timestamptz, last_status int,
  primary key(event_id,user_id)
);
-- Existing admin addresses and queued messages survive upgrades.
alter table staff_mail.addresses add column if not exists hotel boolean not null default false,
  add column if not exists transfer boolean not null default false;
alter table staff_mail.outbox add column if not exists for_hotel boolean not null default false,
  add column if not exists for_transfer boolean not null default false;

create or replace function public.staff_get_mail_preferences(target uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prefs staff_mail.addresses;
begin
  if auth.uid() is null or not exists(select 1 from public.staff_profiles p where p.user_id=target
    and (target=auth.uid() or public.is_staff_admin())) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  select * into prefs from staff_mail.addresses where user_id=target;
  return jsonb_build_object('email',coalesce(prefs.email,''),'hotel',coalesce(prefs.hotel,false),
    'transfer',coalesce(prefs.transfer,false),'configured',prefs.user_id is not null);
end;
$$;
create or replace function public.staff_save_mail_preferences(target uuid,address text,hotel_updates boolean,transfer_updates boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  target_role text;
  mailbox text:=trim(coalesce(address,''));
begin
  select p.role into target_role from public.staff_profiles p where p.user_id=target
    and (target=auth.uid() or (public.is_staff_admin() and (p.role='user' or exists(
      select 1 from public.staff_profiles actor where actor.user_id=auth.uid() and actor.is_primary_admin))));
  if auth.uid() is null or target_role is null then raise exception 'Access denied' using errcode='42501'; end if;
  if (mailbox='' and (target_role='admin' or hotel_updates or transfer_updates))
    or (mailbox<>'' and (length(mailbox)>254 or mailbox !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$')) then
    raise exception 'Enter a valid notification email or disable updates.';
  end if;
  insert into staff_mail.addresses(user_id,email,hotel,transfer)
    values(target,mailbox,target_role='user' and coalesce(hotel_updates,false),target_role='user' and coalesce(transfer_updates,false))
    on conflict(user_id) do update set email=excluded.email,hotel=excluded.hotel,transfer=excluded.transfer;
  -- Discard opted-out pending notices so subscribing again cannot send them later.
  delete from staff_mail.outbox q where q.user_id=target and q.delivered_at is null
    and ((q.body is not null and q.body#>>'{to,0}'<>mailbox) or
      (target_role='user' and not ((q.for_hotel and hotel_updates) or (q.for_transfer and transfer_updates))));
end;
$$;
revoke all on function public.staff_get_mail_preferences(uuid),public.staff_save_mail_preferences(uuid,text,boolean,boolean) from public,anon;
grant execute on function public.staff_get_mail_preferences(uuid),public.staff_save_mail_preferences(uuid,text,boolean,boolean) to authenticated;

-- Attach the exact slot to group changes so alerts reach only its passengers.
create or replace function public.staff_log_transfer_assignment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    if old.driver_ids is not distinct from new.driver_ids then return new; end if;
  end if;
  if to_regclass('public.staff_activity_logs') is not null then
    perform public.staff_append_activity('transfer_updated',null,'Shared transfer',
      jsonb_build_object('slot',jsonb_build_array(new.day,new.pickup_time,new.leg,new.airport,new.hotel),'changes',jsonb_build_array(jsonb_build_object(
        'label', new.day::text||' '||new.pickup_time||' · '||new.leg||' · Drivers',
        'before',case when tg_op='INSERT' then '' else array_to_string(old.driver_ids,', ') end,
        'after',array_to_string(new.driver_ids,', ')))));
  end if;
  return new;
end;
$$;
revoke all on function public.staff_log_transfer_assignment() from public, anon, authenticated;

create or replace function staff_mail.enqueue() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  slot jsonb:=new.details->'slot';
  hotel_event boolean;
  transfer_event boolean;
  changes jsonb:=coalesce(new.details->'changes','[]');
begin
  hotel_event:=new.kind like 'hotel!_%' escape '!';
  transfer_event:=new.kind in ('transfer_updated','hotel_created','hotel_canceled') or
    exists(select 1 from jsonb_array_elements(changes) c where c->>'label' in
      ('Hotel','Arrival flight','Arrival origin','Arrival airport','Arrival date','Arrival time',
       'Return flight','Return origin','Return destination','Departure date','Departure time','Hotel pickup date','Hotel pickup time'));
  if new.kind in ('transfer_updated','hotel_edited') then
    hotel_event:=exists(select 1 from jsonb_array_elements(changes) c where c->>'label' in
      ('Hotel','Check-in','Check-out','Project','Comments','Hotel loyalty number'));
  end if;
  insert into staff_mail.outbox(event_id,user_id,for_hotel,for_transfer)
  select new.id,p.user_id,p.role='user' and hotel_event and a.hotel,p.role='user' and transfer_event and a.transfer
  from public.staff_profiles p left join staff_mail.addresses a on a.user_id=p.user_id
  where p.role='admin' or (p.role='user' and a.email<>'' and ((hotel_event and a.hotel) or (transfer_event and a.transfer))
    and (p.user_id=new.subject_user_id or (slot is not null and exists (
      select 1 from public.staff_hotel_requests h where h.owner_user_id=p.user_id and nullif(h.record->>'canceledAt','') is null
        and coalesce(h.record#>>array['transfers',slot->>2,'status'],'')<>'canceled'
        and case when slot->>2='arrival' then h.record->>'outDate'=slot->>0 and h.record->>'outTime'=slot->>1
          and upper(trim(h.record->>'outDestination'))=slot->>3
        else h.record->>'pickupDate'=slot->>0 and h.record->>'pickupTime'=slot->>1 and upper(trim(h.record->>'returnOrigin'))=slot->>3
          and lower(trim(h.record->>'hotel'))=slot->>4 end))));
  return new;
end;
$$;
drop trigger if exists staff_request_email on public.staff_activity_logs;
create trigger staff_request_email after insert on public.staff_activity_logs
for each row execute function staff_mail.enqueue();

create or replace function staff_mail.deliver() returns void
language plpgsql security definer set search_path='' as $$
declare
  api_key text;
  sender text;
  item record;
  payload jsonb;
  network_id bigint;
begin
  if not pg_try_advisory_xact_lock(2364129) then return; end if;
  update staff_mail.outbox q set request_id=null,last_status=coalesce(r.status_code,0),
    delivered_at=case when r.status_code between 200 and 299 then now() end
  from net._http_response r where q.request_id=r.id;
  select decrypted_secret into api_key from vault.decrypted_secrets where name='staff_resend_api_key';
  select decrypted_secret into sender from vault.decrypted_secrets where name='staff_email_from';
  if api_key is null or sender is null then return; end if;
  for item in
    select q.*,a.email,e.kind,e.subject_name,e.actor_name,e.created_at,e.details
    from staff_mail.outbox q
    join public.staff_profiles p on p.user_id=q.user_id
    join staff_mail.addresses a on a.user_id=p.user_id
    join public.staff_activity_logs e on e.id=q.event_id
    where q.delivered_at is null and q.attempts<8 and a.email<>''
      and (p.role='admin' or (q.for_hotel and a.hotel) or (q.for_transfer and a.transfer))
      and (q.attempted_at is null or q.attempted_at<now()-interval '3 minutes')
      and (q.request_id is null or q.attempted_at<now()-interval '15 minutes')
    order by q.event_id,q.user_id limit 20 for update of q skip locked
  loop
    payload=coalesce(item.body,jsonb_build_object(
      'from',sender,'to',jsonb_build_array(item.email),
      'subject','Staff Planner · '||replace(item.kind,'_',' '),
      'text',concat_ws(E'\n',initcap(replace(item.kind,'_',' ')),
        'Team member: '||item.subject_name,'Changed by: '||item.actor_name,
        'Time (UTC): '||to_char(item.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI'),
        'Stay: '||(item.details#>>'{trip,checkin}')||' to '||(item.details#>>'{trip,checkout}'),
        'Changed: '||(select string_agg(c->>'label',', ') from jsonb_array_elements(item.details->'changes') c),
        'Open Staff Planner for details.')));
    -- Never retry an old payload addressed to a superseded mailbox.
    if payload#>>'{to,0}' <> item.email then continue; end if;
    network_id=net.http_post(url:='https://api.resend.com/emails',
      headers:=jsonb_build_object('Authorization','Bearer '||api_key,
        'Content-Type','application/json','Idempotency-Key','staff-'||item.event_id||'-'||item.user_id),
      body:=payload,timeout_milliseconds:=10000);
    update staff_mail.outbox set body=payload,request_id=network_id,attempts=attempts+1,
      attempted_at=now() where event_id=item.event_id and user_id=item.user_id;
  end loop;
end;
$$;
revoke all on all functions in schema staff_mail from public,anon,authenticated;
select cron.schedule('staff-request-mail','* * * * *','select staff_mail.deliver()');
commit;
