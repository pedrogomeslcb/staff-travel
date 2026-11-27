-- Optional self-service profile: preserve all existing admin policies.
-- Run after ihg-by-username.sql. Each user may write ONLY their own membership.
drop policy if exists staff_ihg_self_insert on public.staff_ihg_memberships;
create policy staff_ihg_self_insert on public.staff_ihg_memberships for insert to authenticated
  with check (user_id=(select auth.uid()));
drop policy if exists staff_ihg_self_update on public.staff_ihg_memberships;
create policy staff_ihg_self_update on public.staff_ihg_memberships for update to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists staff_ihg_self_delete on public.staff_ihg_memberships;
create policy staff_ihg_self_delete on public.staff_ihg_memberships for delete to authenticated
  using (user_id=(select auth.uid()));
