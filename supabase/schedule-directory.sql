-- Staff & Travel: read-only team directory for Schedule.
-- Run once in Supabase > SQL Editor, after the staff_profiles table exists.
-- Users and admins can see everyone except the protected Primary Admin.
-- Existing RLS protections for full profiles and IHG memberships remain unchanged.

create or replace function public.staff_schedule_directory()
returns table (
  user_id uuid,
  display_name text,
  username text,
  role text,
  department text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Only active registered staff may look up the schedule directory.
  if (select auth.uid()) is null or not exists (
    select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid())
      and p.role in ('user','admin')
  ) then
    raise exception 'A registered staff account is required'
      using errcode = '42501';
  end if;

  return query
  select p.user_id,
         p.display_name,
         p.username,
         p.role,
         p.department
  from public.staff_profiles p
  where p.is_primary_admin = false
    and p.role in ('user','admin')
  order by p.display_name nulls last, p.username;
end;
$$;

revoke all on function public.staff_schedule_directory()
  from public, anon;
grant execute on function public.staff_schedule_directory()
  to authenticated;

-- Validate: the Primary Admin must not be included.
-- When testing as a signed-in user, the app calls this RPC with their session.
