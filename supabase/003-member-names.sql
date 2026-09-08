-- Names for the phones taking part, and letting members see each other.
--
-- Run this once in the Supabase dashboard -> SQL Editor -> Run, on a project
-- that already has schema.sql and 002 applied.
--
-- Until now a device could only read its own membership row, so the sharing
-- screen had no way to show who else had joined. Membership is now readable by
-- everyone in the same session, and each device may name itself.

alter table public.session_members
  add column if not exists name text;

-- Anyone in the session can see who else is in it.
drop policy if exists members_read on public.session_members;
create policy members_read on public.session_members
  for select using (public.is_member(session_id));

-- A device may name itself, and only itself. There is deliberately no insert
-- or delete policy: joining still goes through join_session, which is what
-- keeps the join code the only way in.
drop policy if exists members_name_own on public.session_members;
create policy members_name_own on public.session_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- So the list updates as people join rather than needing a refresh.
alter table public.session_members replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.session_members;
exception when duplicate_object then null;
end $$;
