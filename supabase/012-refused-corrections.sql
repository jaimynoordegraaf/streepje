-- 012: a refused turf removal is ignored, not an error.
--
-- A phone that stops being an admin can still be holding a turf removal it made
-- a moment before: tapped while offline, or before the news reached it. The
-- insert policy refused that row, and one refused row fails the whole batch it
-- was sent in. The phone then retried the same batch forever, stuck on
-- "Offline" with every later turf queued behind it. Starting to share again
-- failed the same way, because that resends every turf the phone has.
--
-- Like the menu, payments and the list's details, a removal from a phone that
-- is not an admin is now dropped quietly. It still never reaches the list. The
-- app sees afterwards that the row is missing and drops it from its own copy.

create or replace function public.guard_entry()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is not null
     and new.delta <= 0
     and not public.is_admin(new.session_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists order_entries_guard on public.order_entries;
create trigger order_entries_guard
  before insert on public.order_entries
  for each row execute function public.guard_entry();

-- Membership is still checked here; who may remove is now guard_entry's job.
drop policy if exists entries_insert on public.order_entries;
create policy entries_insert on public.order_entries
  for insert with check (public.is_member(session_id));
