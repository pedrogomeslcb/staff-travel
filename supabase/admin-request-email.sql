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
create or replace function public.staff_notification_address()
returns text language sql stable security definer set search_path='' as $$
  select a.email from staff_mail.addresses a
  where a.user_id=auth.uid() and public.is_staff_admin()
$$;
create or replace function public.staff_set_notification_address(address text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if address is null or length(address)>254 or trim(address) !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then
    raise exception 'Enter one valid email address';
  end if;
  insert into staff_mail.addresses values(auth.uid(),trim(address))
  on conflict(user_id) do update set email=excluded.email;
end;
$$;
revoke all on function public.staff_notification_address(), public.staff_set_notification_address(text) from public,anon;
grant execute on function public.staff_notification_address(), public.staff_set_notification_address(text) to authenticated;

create or replace function staff_mail.enqueue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into staff_mail.outbox(event_id,user_id)
  select new.id,user_id from public.staff_profiles where role='admin';
  return new;
end;
$$;
drop trigger if exists staff_request_email on public.staff_activity_logs;
create trigger staff_request_email after insert on public.staff_activity_logs
for each row when (new.kind like 'hotel!_%' escape '!' or new.kind='transfer_updated')
execute function staff_mail.enqueue();

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
    join public.staff_profiles p on p.user_id=q.user_id and p.role='admin'
    join staff_mail.addresses a on a.user_id=p.user_id
    join public.staff_activity_logs e on e.id=q.event_id
    where q.delivered_at is null and q.attempts<8
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
        'Open Staff Planner → Logs for details.')));
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
