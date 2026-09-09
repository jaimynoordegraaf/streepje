-- 007: deleting a shared list, and taking the power to do it away from guests.
--
-- Until now a shared event could only be abandoned. Stopping sharing left the
-- names and the whole order log sitting on the server for good, which is both
-- poor privacy and the reason Play's "can users have their data deleted?"
-- question had to be answered no.
--
-- Deleting goes through a function rather than a policy, because the sessions
-- row cascades to everything else: being able to delete it is being able to
-- erase the entire order log in one statement. That is exactly the power the
-- correction PIN exists to keep on the host phone.

create or replace function public.delete_session(p_session_id text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_host(p_session_id) then
    raise exception 'Only the host may delete this session';
  end if;

  -- Members, people, items and order entries all cascade from here.
  delete from public.sessions where id = p_session_id;
end;
$$;

-- The old policy was `for all`, which quietly included delete: any phone that
-- had joined could have wiped the shared list and every turf in it. Reading and
-- updating stay open to members; deleting is now only possible through the
-- function above, which checks who is asking.
drop policy if exists sessions_rw on public.sessions;

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions
  for select using (public.is_member(id));

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update using (public.is_member(id)) with check (public.is_member(id));
