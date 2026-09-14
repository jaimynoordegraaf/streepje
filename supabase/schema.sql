-- Turf: shared session storage.
-- Paste this whole file into the Supabase dashboard -> SQL Editor -> Run.

-- ---------------------------------------------------------------- tables ---

create table if not exists public.sessions (
  id          text primary key,
  join_code   text not null unique,
  name        text not null,
  closed      boolean not null default false,
  -- 'event' for one occasion, 'tab' for the season tab. Fixed at creation.
  kind        text not null default 'event' check (kind in ('event', 'tab')),
  host_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Who is allowed to see a session. A row is added only by the two functions
-- below, so nobody can add themselves to a session they were not invited to.
create table if not exists public.session_members (
  session_id  text not null references public.sessions(id) on delete cascade,
  user_id     uuid not null,
  name        text,
  joined_at   timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Which phones may correct a list: remove turfs, remove people, change the
-- menu, delete the list, and add or remove other admins. Admins are equal, and
-- a list always keeps at least one (see remove_admin).
create table if not exists public.session_admins (
  session_id  text not null references public.sessions(id) on delete cascade,
  user_id     uuid not null,
  added_by    uuid,
  added_at    timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.session_people (
  id          text primary key,
  session_id  text not null references public.sessions(id) on delete cascade,
  name        text not null,
  paid        boolean not null default false,
  paid_cents  integer not null default 0,
  removed_at  timestamptz,
  removed_by  text,
  paid_at     timestamptz,
  -- For someone at an event: the same person's id in the season tab, so their
  -- turfs there land on the same invoice. Matched by id, never by name.
  member_id   text,
  -- 'invoice': onto the quarterly invoice. 'tonight': settled on the night.
  billing     text not null default 'tonight' check (billing in ('invoice', 'tonight')),
  -- Who a guest came with: a person id in the same list.
  guest_of    text
);

create table if not exists public.session_items (
  id          text primary key,
  session_id  text not null references public.sessions(id) on delete cascade,
  name        text not null,
  price_cents integer not null,
  category    text not null check (category in ('drink','food')),
  hidden      boolean not null default false
);

-- The order log. Rows are only ever inserted, never updated or deleted, which
-- is what lets several phones log at once without overwriting each other.
create table if not exists public.order_entries (
  id          text primary key,
  session_id  text not null references public.sessions(id) on delete cascade,
  person_id   text not null,
  item_id     text not null,
  delta       integer not null,
  device_id   text not null,
  device_name text,
  -- The price at the moment of the tap, so a menu change never reprices turfs
  -- already made. Filled in by fill_entry_price below when a client sends none.
  price_cents integer,
  created_at  timestamptz not null default now()
);

create index if not exists order_entries_session_idx on public.order_entries (session_id);

-- ------------------------------------------------------------- functions ---

-- Is the caller a member of this session? Used by every policy below.
create or replace function public.is_member(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = auth.uid()
  );
$$;

-- Is the caller an admin of this session? Admins correct the list; see
-- session_admins.
create or replace function public.is_admin(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.session_admins a
    where a.session_id = p_session_id and a.user_id = auth.uid()
  );
$$;

-- "Host" predates admins and now means the same thing, so anything still
-- asking the old question gets the new answer.
create or replace function public.is_host(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select public.is_admin(p_session_id);
$$;

-- Creating a session also makes the creator its first member, in one step.
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

  -- ...and its first admin.
  insert into public.session_admins (session_id, user_id, added_by)
  values (p_id, auth.uid(), auth.uid());
end;
$$;

-- Joining by code. This is the only way to become a member of someone else's
-- session, and it requires knowing the code.
create or replace function public.join_session(p_join_code text)
returns text language plpgsql security definer
set search_path = public as $$
declare
  v_id text;
begin
  select id into v_id from public.sessions where join_code = upper(p_join_code);
  if v_id is null then
    raise exception 'No session with that code';
  end if;

  insert into public.session_members (session_id, user_id)
  values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end;
$$;

-- Deleting a shared list, so an event's data need not outlive the event.
-- Host only: the sessions row cascades to everything else, so this erases the
-- whole order log, which is the one thing a guest phone must never be able to
-- do.
create or replace function public.delete_session(p_session_id text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin(p_session_id) then
    raise exception 'Only an admin may delete this session';
  end if;

  delete from public.sessions where id = p_session_id;
end;
$$;

create or replace function public.add_admin(p_session_id text, p_user_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin(p_session_id) then
    raise exception 'Only an admin may add admins';
  end if;

  if not exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = p_user_id
  ) then
    raise exception 'That phone has not joined this list';
  end if;

  insert into public.session_admins (session_id, user_id, added_by)
  values (p_session_id, p_user_id, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.remove_admin(p_session_id text, p_user_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin(p_session_id) then
    raise exception 'Only an admin may remove admins';
  end if;

  -- Two admins removing each other at the same moment would each see two
  -- admins and leave none. Locking the list first makes them take turns.
  perform 1 from public.sessions where id = p_session_id for update;

  if exists (
    select 1 from public.session_admins
    where session_id = p_session_id and user_id = p_user_id
  ) and (
    select count(*) from public.session_admins where session_id = p_session_id
  ) <= 1 then
    raise exception 'A list always keeps at least one admin';
  end if;

  delete from public.session_admins
  where session_id = p_session_id and user_id = p_user_id;
end;
$$;

-- The price of a turf comes from the menu on the server, not from the phone,
-- so every price is one only an admin controls. A turf for an item the server
-- has not seen yet keeps the phone's price, as there is nothing to check it
-- against; one that never reaches the menu counts for nothing.
create or replace function public.fill_entry_price()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_price integer;
begin
  select i.price_cents into v_price
    from public.session_items i
   where i.id = new.item_id
     and i.session_id = new.session_id;

  if found then
    new.price_cents := v_price;
  end if;
  return new;
end;
$$;

drop trigger if exists order_entries_fill_price on public.order_entries;
create trigger order_entries_fill_price
  before insert on public.order_entries
  for each row execute function public.fill_entry_price();

-- The menu, and with it every price, is an admin's to change. A change from
-- anyone else is ignored rather than refused: every phone pushes its whole
-- menu, and refusing a stale copy would stop that phone syncing at all.
create or replace function public.guard_menu()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  -- The SQL editor and other server-side work carry no user.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Deleting a whole list cascades here, and that was already checked.
    if not exists (select 1 from public.sessions s where s.id = old.session_id) then
      return old;
    end if;
    if public.is_admin(old.session_id) then
      return old;
    end if;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if public.is_admin(old.session_id) then
      new.session_id := old.session_id;
      return new;
    end if;
    return old;
  end if;

  -- INSERT
  if public.is_admin(new.session_id) then
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists session_items_guard on public.session_items;
create trigger session_items_guard
  before insert or update or delete on public.session_items
  for each row execute function public.guard_menu();

-- People: anyone who joined may add someone and rename them. Only an admin may
-- record a payment, take someone off the list or put them back. Changes to
-- those from anyone else are ignored, for the same reason as the menu.
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

drop trigger if exists session_people_guard on public.session_people;
create trigger session_people_guard
  before insert or update or delete on public.session_people
  for each row execute function public.guard_people();

-- What a list is, its join code, and who made it are fixed at creation. Phones
-- may rename a list and close it; a change to anything else is ignored. The
-- join code matters beyond tidiness: any phone that joined could otherwise
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

-- ------------------------------------------------------------- policies ----

alter table public.sessions        enable row level security;
alter table public.session_members enable row level security;
alter table public.session_people  enable row level security;
alter table public.session_items   enable row level security;
alter table public.order_entries   enable row level security;

-- Members read and update; nobody deletes directly. Deletion goes through
-- delete_session above, which checks who is asking.
drop policy if exists sessions_rw on public.sessions;

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions
  for select using (public.is_member(id));

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read on public.session_members;
create policy members_read on public.session_members
  for select using (public.is_member(session_id));

-- A device may name itself, and only itself.
drop policy if exists members_name_own on public.session_members;
create policy members_name_own on public.session_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists people_rw on public.session_people;
create policy people_rw on public.session_people
  for all using (public.is_member(session_id)) with check (public.is_member(session_id));

drop policy if exists items_rw on public.session_items;
create policy items_rw on public.session_items
  for all using (public.is_member(session_id)) with check (public.is_member(session_id));

-- Entries can be read and added by members, but never changed or removed:
-- there is deliberately no update or delete policy.
drop policy if exists entries_read on public.order_entries;
create policy entries_read on public.order_entries
  for select using (public.is_member(session_id));

drop policy if exists entries_insert on public.order_entries;
create policy entries_insert on public.order_entries
  for insert with check (
    public.is_member(session_id)
    and (delta > 0 or public.is_admin(session_id))
  );

-- Every phone in a list can see who its admins are. Adding and removing goes
-- through add_admin and remove_admin, which check who is asking.
alter table public.session_admins enable row level security;

drop policy if exists admins_read on public.session_admins;
create policy admins_read on public.session_admins
  for select using (public.is_member(session_id));

-- ------------------------------------------------------------- realtime ----

alter table public.sessions        replica identity full;
alter table public.session_members replica identity full;
alter table public.session_people replica identity full;
alter table public.session_items  replica identity full;
alter table public.order_entries  replica identity full;
alter table public.session_admins replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.sessions;
  alter publication supabase_realtime add table public.session_members;
  alter publication supabase_realtime add table public.session_people;
  alter publication supabase_realtime add table public.session_items;
  alter publication supabase_realtime add table public.order_entries;
  alter publication supabase_realtime add table public.session_admins;
exception when duplicate_object then null;
end $$;
