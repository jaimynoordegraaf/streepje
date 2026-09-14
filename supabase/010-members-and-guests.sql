-- 010: tabs, members and guests.
--
-- Until now every list was an evening: people added by name, everyone settling
-- up at the end. The bar is also used on ordinary nights across the season,
-- where members are not asked for money at all -- the treasurer invoices them
-- each quarter. And an event has three kinds of people: members (invoiced),
-- plus-ones or outside guests who pay on the night, and guests who left their
-- details and are invoiced after all.

-- ----------------------------------------------------------------- lists ----

-- A list is an event or the season tab. Set when it is created and never
-- changed afterwards: turning an event into a tab would move its guests onto
-- the invoice.
alter table public.sessions add column if not exists kind text not null default 'event';
alter table public.sessions drop constraint if exists sessions_kind_check;
alter table public.sessions add constraint sessions_kind_check check (kind in ('event', 'tab'));

-- ---------------------------------------------------------------- people ----

-- member_id links someone at an event to the same person in the season tab, so
-- their drinks at the event land on the same invoice. Matched by id, never by
-- name: "Jan" and "Jan de V." must not become two people on an invoice.
alter table public.session_people add column if not exists member_id text;

-- invoice: onto the treasurer's quarterly invoice. tonight: settled at the end
-- of the evening. Existing people keep settling on the night, which is how every
-- list worked until now.
alter table public.session_people add column if not exists billing text not null default 'tonight';
alter table public.session_people drop constraint if exists session_people_billing_check;
alter table public.session_people add constraint session_people_billing_check
  check (billing in ('invoice', 'tonight'));

-- Who a guest came with, for the treasurer's benefit: a person id in the same list.
alter table public.session_people add column if not exists guest_of text;

-- -------------------------------------------------------------- creating ----

-- create_session learns the kind. The three-argument version is dropped rather
-- than left beside the new one, because two candidates would make every call
-- ambiguous. An app that still sends three arguments gets the default: an event.
drop function if exists public.create_session(text, text, text);

create or replace function public.create_session(
  p_id text,
  p_join_code text,
  p_name text,
  p_kind text default 'event'
)
returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.sessions (id, join_code, name, host_id, kind)
  values (p_id, upper(p_join_code), p_name, auth.uid(), coalesce(p_kind, 'event'));

  insert into public.session_members (session_id, user_id)
  values (p_id, auth.uid());

  insert into public.session_admins (session_id, user_id, added_by)
  values (p_id, auth.uid(), auth.uid());
end;
$$;

-- ---------------------------------------------------- what cannot change ----

-- What a list is, its join code, and who made it are fixed at creation. Phones
-- may still rename a list and close it. A change to anything else is ignored
-- rather than refused, for the same reason as in 009: phones push their copy of
-- a list, and an error on a stale copy would stop that phone syncing.
--
-- The join code matters beyond tidiness: any phone that joined could otherwise
-- change it and lock everyone else out of joining.
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
  return new;
end;
$$;

drop trigger if exists sessions_guard on public.sessions;
create trigger sessions_guard
  before update on public.sessions
  for each row execute function public.guard_session();

-- People: how someone pays, and which member they are, now count as money
-- decisions alongside payments and removal. A phone that joined may still set
-- them when adding someone -- a helper at the door adds the guests -- but only
-- an admin may change them afterwards.
create or replace function public.guard_people()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from public.sessions s where s.id = old.session_id) then
      return old;
    end if;
    if public.is_admin(old.session_id) then
      return old;
    end if;
    return null;
  end if;

  if tg_op = 'INSERT' then
    -- A member may add someone, but not someone already paid up or removed.
    -- For an upsert of an existing person this runs first, and the update
    -- below then restores what was stored, so nothing is lost.
    if not public.is_admin(new.session_id) then
      new.paid := false;
      new.paid_cents := 0;
      new.paid_at := null;
      new.removed_at := null;
      new.removed_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  new.session_id := old.session_id;
  if not public.is_admin(old.session_id) then
    new.paid := old.paid;
    new.paid_cents := old.paid_cents;
    new.paid_at := old.paid_at;
    new.removed_at := old.removed_at;
    new.removed_by := old.removed_by;
    new.billing := old.billing;
    new.member_id := old.member_id;
  end if;
  return new;
end;
$$;
