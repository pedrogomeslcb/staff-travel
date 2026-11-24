-- Run after admin-activity-logs.sql and shared-transfer-pickups.sql.
begin;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists staff_mail;
revoke all on schema staff_mail from public, anon, authenticated;
-- Serialize cutover with a running dispatcher.
select pg_advisory_xact_lock(2364129);
lock table public.staff_activity_logs in share row exclusive mode;
drop function if exists public.staff_get_mail_preferences(uuid);
drop function if exists public.staff_save_mail_preferences(uuid,text,boolean,boolean);
drop function if exists public.staff_notification_address();
drop function if exists public.staff_set_notification_address(text);

create table if not exists staff_mail.primary_outbox (
  event_id bigint primary key references public.staff_activity_logs(id) on delete cascade,
  body jsonb, request_id bigint, attempts int not null default 0,
  attempted_at timestamptz, delivered_at timestamptz, last_status int
);
revoke all on staff_mail.primary_outbox from public,anon,authenticated;
-- Transfer untouched pending events once. Never replay a previously attempted delivery.
do $$
begin
  if to_regclass('staff_mail.outbox') is not null then
    insert into staff_mail.primary_outbox(event_id)
    select event_id from staff_mail.outbox group by event_id
    having bool_and(attempts=0 and request_id is null and delivered_at is null)
    on conflict do nothing;
  end if;
end;
$$;
create or replace function staff_mail.enqueue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into staff_mail.primary_outbox(event_id) values(new.id) on conflict do nothing;
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
  recipient text;
  item record;
  payload jsonb;
  network_id bigint;
begin
  if not pg_try_advisory_xact_lock(2364129) then return; end if;
  update staff_mail.primary_outbox q set request_id=null,last_status=coalesce(r.status_code,0),
    delivered_at=case when r.status_code between 200 and 299 then now() end
  from net._http_response r where q.request_id=r.id;
  select decrypted_secret into api_key from vault.decrypted_secrets where name='staff_resend_api_key';
  select decrypted_secret into sender from vault.decrypted_secrets where name='staff_email_from';
  select trim(decrypted_secret) into recipient from vault.decrypted_secrets where name='staff_email_to';
  if api_key is null or sender is null or recipient is null or recipient !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then return; end if;
  for item in
    select q.*,e.kind,e.subject_name,e.actor_name,e.created_at,e.details
    from staff_mail.primary_outbox q
    join public.staff_activity_logs e on e.id=q.event_id
    where q.delivered_at is null and q.attempts<8
      and (q.attempted_at is null or q.attempted_at<now()-interval '3 minutes')
      and (q.request_id is null or q.attempted_at<now()-interval '15 minutes')
    order by q.event_id limit 20 for update of q skip locked
  loop
    payload=coalesce(item.body,jsonb_build_object(
      'from',sender,'to',jsonb_build_array(recipient),
      'subject','Staff Planner · '||replace(item.kind,'_',' '),
      'text',concat_ws(E'\n',initcap(replace(item.kind,'_',' ')),
        'Team member: '||item.subject_name,'Changed by: '||item.actor_name,
        'Time (UTC): '||to_char(item.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI'),
        'Stay: '||(item.details#>>'{trip,checkin}')||' to '||(item.details#>>'{trip,checkout}'),
        'Changed: '||(select string_agg(c->>'label',', ') from jsonb_array_elements(item.details->'changes') c),
        'Open Staff Planner for details.')));
    -- Never retry an old payload addressed to a superseded mailbox.
    if payload#>>'{to,0}' <> recipient then continue; end if;
    network_id=net.http_post(url:='https://api.resend.com/emails',
      headers:=jsonb_build_object('Authorization','Bearer '||api_key,
        'Content-Type','application/json','Idempotency-Key','staff-primary-'||item.event_id),
      body:=payload,timeout_milliseconds:=10000);
    update staff_mail.primary_outbox set body=payload,request_id=network_id,attempts=attempts+1,
      attempted_at=now() where event_id=item.event_id;
  end loop;
end;
$$;
revoke all on all functions in schema staff_mail from public,anon,authenticated;
select cron.schedule('staff-request-mail','* * * * *','select staff_mail.deliver()');
commit;
