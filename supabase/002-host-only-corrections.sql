-- Only the host may remove a turf.
--
-- Run this once in the Supabase dashboard -> SQL Editor -> Run, on a project
-- that already has schema.sql applied.
--
-- The app hides the minus button on guest phones, but that is only a hint: a
-- modified client could still send a negative row. This makes the rule real,
-- because the database itself refuses one from anybody except the host.
--
-- Adding is unchanged. Any member may insert a positive row, which is what
-- lets several people take orders at once.

create or replace function public.is_host(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.host_id = auth.uid()
  );
$$;

drop policy if exists entries_insert on public.order_entries;
create policy entries_insert on public.order_entries
  for insert with check (
    public.is_member(session_id)
    and (delta > 0 or public.is_host(session_id))
  );

-- There is still deliberately no update or delete policy on order_entries:
-- history is added to, never rewritten.
