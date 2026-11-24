-- Read-only diagnostic for recent hotel-created emails. Run in the SQL Editor.
-- Only configuration presence is returned. No keys, addresses or message bodies.
with config as (
  select exists(select 1 from vault.decrypted_secrets where name='staff_resend_api_key' and nullif(trim(decrypted_secret),'') is not null) as api_key_set,
         exists(select 1 from vault.decrypted_secrets where name='staff_email_from' and nullif(trim(decrypted_secret),'') is not null) as sender_set,
         exists(select 1 from cron.job where jobname='staff-request-mail' and active) as cron_active
), events as (
  select id,created_at,subject_name,details from public.staff_activity_logs
  where kind='hotel_created' order by id desc limit 10
)
select e.created_at, e.subject_name as traveler, e.details#>>'{trip,checkin}' as checkin,
       p.username as admin, config.*, q.attempts, q.last_status, q.delivered_at as provider_accepted_at,
       case when q.delivered_at is not null then 'Accepted by Resend: check delivery log'
            when q.event_id is null then 'No queue entry for this admin'
            when nullif(trim(a.email),'') is null then 'Missing admin notification address'
            when not api_key_set then 'Missing Resend key in Vault'
            when not sender_set then 'Missing sender in Vault'
            when not cron_active then 'Mail cron inactive'
            when q.last_status is not null then 'See last_status and Resend log'
            when q.attempts=0 then 'Waiting for dispatch: check cron run history'
            else 'Awaiting provider response' end as diagnosis
from config cross join events e cross join public.staff_profiles p
left join staff_mail.outbox q on q.event_id=e.id and q.user_id=p.user_id
left join staff_mail.addresses a on a.user_id=p.user_id
where p.role='admin' order by e.id desc,p.username;
