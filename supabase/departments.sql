-- Staff & Travel | Department tag
-- Run in Supabase > SQL Editor before using the Department field.
-- Safe to run again. All existing staff profiles are preserved.

alter table public.staff_profiles
  add column if not exists department text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_profiles'::regclass
      and conname = 'staff_profiles_department_allowed'
  ) then
    alter table public.staff_profiles
      add constraint staff_profiles_department_allowed
      check (
        department is null
        or department in ('TMO', 'Cost Excellence', 'Revenue Enhancement')
      );
  end if;
end;
$$;

-- Existing RLS stays unchanged: admins can read all profiles, and only the
-- authenticated server-side staff-admin-users function may update departments.

select username, display_name, department
from public.staff_profiles
order by display_name;
