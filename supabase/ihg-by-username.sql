-- IHG membership belongs to a registered username, not to the staff code.
-- Run once in Supabase SQL Editor. Safe to rerun.
-- The original public.ihg_memberships table is preserved as a legacy backup.

create table if not exists public.staff_ihg_memberships (
  user_id uuid primary key references public.staff_profiles(user_id) on delete cascade,
  membership text not null check (length(trim(membership)) between 1 and 64),
  updated_at timestamptz not null default now()
);

alter table public.staff_ihg_memberships enable row level security;

revoke all on public.staff_ihg_memberships from anon;
grant select, insert, update, delete on public.staff_ihg_memberships to authenticated;

drop policy if exists staff_ihg_read on public.staff_ihg_memberships;
create policy staff_ihg_read on public.staff_ihg_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_staff_admin())
  );

drop policy if exists staff_ihg_admin_insert on public.staff_ihg_memberships;
create policy staff_ihg_admin_insert on public.staff_ihg_memberships
  for insert to authenticated
  with check ((select public.is_staff_admin()));

drop policy if exists staff_ihg_admin_update on public.staff_ihg_memberships;
create policy staff_ihg_admin_update on public.staff_ihg_memberships
  for update to authenticated
  using ((select public.is_staff_admin()))
  with check ((select public.is_staff_admin()));

drop policy if exists staff_ihg_admin_delete on public.staff_ihg_memberships;
create policy staff_ihg_admin_delete on public.staff_ihg_memberships
  for delete to authenticated
  using ((select public.is_staff_admin()));

-- The old staff-code table is only an administrative migration source now.
-- Do not allow ordinary users to infer an IHG number from a staff code.
drop policy if exists ihg_read on public.ihg_memberships;
drop policy if exists ihg_admin_read on public.ihg_memberships;
create policy ihg_admin_read on public.ihg_memberships
  for select to authenticated
  using ((select public.is_staff_admin()));

-- Migrate only memberships that already have a verifiable staff-code match.
-- Example: username pg with staff_code P/G receives the old P/G membership.
-- Unmatched legacy entries A/B, C/D etc. remain safely in the original table
-- until an admin links them to a registered username.
insert into public.staff_ihg_memberships(user_id, membership)
select p.user_id, trim(m.membership)
from public.staff_profiles p
join public.ihg_memberships m
  on upper(trim(p.staff_code)) = upper(trim(m.staff_code))
where trim(m.membership) <> ''
on conflict (user_id) do nothing;

-- Report linked usernames / memberships for verification.
select p.username, p.display_name, p.staff_code,
       coalesce(m.membership, 'Not linked') as ihg_membership
from public.staff_profiles p
left join public.staff_ihg_memberships m on m.user_id = p.user_id
order by p.username nulls last, p.display_name;
