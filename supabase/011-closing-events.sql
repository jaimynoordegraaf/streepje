-- 011: closing an event is an admin's decision.
--
-- "Evenement afsluiten" used to only set a flag that nothing looked at, and any
-- phone could set it. It now freezes the evening in the app: no more turfs, no
-- new people. That makes closing and reopening a decision about the takings,
-- like payments, so only an admin phone may change it. Anyone else's change is
-- ignored rather than refused, so an older app version keeps syncing.
--
-- The season tab runs for good and cannot be closed at all.
--
-- Turfs themselves are still accepted on a closed list. A phone that was offline
-- when the event was closed may still be holding turfs it made before, and those
-- must arrive rather than disappear.

create or replace function public.guard_session()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.id := old.id;
  new.kind := old.kind;
  new.join_code := old.join_code;
  new.host_id := old.host_id;
  new.created_at := old.created_at;
  if not public.is_admin(old.id) then
    new.closed := old.closed;
  end if;
  if new.kind = 'tab' then
    new.closed := false;
  end if;
  return new;
end;
$$;

-- A tab closed by an earlier version, when the button was still offered there.
update public.sessions set closed = false where kind = 'tab' and closed;
