-- 009: several admin phones instead of one host.
--
-- A shared list used to have exactly one phone that could correct it: the one
-- that created it. For an evening that is fine. For a tab that runs a season,
-- with the treasurer rarely at the bar and volunteers who rotate, it means
-- mistakes nobody present can fix -- and once that one phone is lost, reset or
-- reinstalled, a list that can never be corrected again.
--
-- Admins are equal. Any admin can make another phone that joined into an
-- admin, and a list always keeps at least one.

-- ------------------------------------------------------------- admins ----

create table if not exists public.session_admins (
  session_id  text not null references public.sessions(id) on delete cascade,
  user_id     uuid not null,
  added_by    uuid,
  added_at    timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Every existing list starts with its host as its first admin, so nothing
-- changes for a list until someone adds a second.
insert into public.session_admins (session_id, user_id, added_by)
select id, host_id, host_id from public.sessions
on conflict do nothing;

create or replace function public.is_admin(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.session_admins a
    where a.session_id = p_session_id and a.user_id = auth.uid()
  );
$$;

-- "Host" now means admin, so anything still asking the old question gets the
-- new answer.
create or replace function public.is_host(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select public.is_admin(p_session_id);
$$;

-- Whoever creates a list is its first admin.
create or replace function public.create_session(p_id text, p_join_code text, p_name text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.sessions (id, join_code, name, host_id)
  values (p_id, upper(p_join_code), p_name, auth.uid());

  insert into public.session_members (session_id, user_id)
  values (p_id, auth.uid());

  insert into public.session_admins (session_id, user_id, added_by)
  values (p_id, auth.uid(), auth.uid());
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

create or replace function public.delete_session(p_session_id text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin(p_session_id) then
    raise exception 'Only an admin may delete this session';
  end if;

  -- Members, admins, people, items and order entries all cascade from here.
  delete from public.sessions where id = p_session_id;
end;
$$;

-- --------------------------------------------------- what admins guard ----

-- The menu, and with it every price, is an admin's to change.
--
-- A change from anyone else is ignored rather than refused. Every phone pushes
-- its whole copy of the menu when anything changes. A phone with a slightly
-- stale copy -- or an older app that does not know admins exist -- would get an
-- error on every push and stop syncing altogether. Ignoring the change keeps
-- that phone working, and the next sync hands it the real menu.
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
-- record a payment, take someone off the list, or put them back -- the things
-- that change what someone owes. As with the menu, a change to those from
-- anyone else is ignored rather than refused.
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
  end if;
  return new;
end;
$$;

drop trigger if exists session_people_guard on public.session_people;
create trigger session_people_guard
  before insert or update or delete on public.session_people
  for each row execute function public.guard_people();

-- The price of a turf now comes from the menu on the server, not from the
-- phone. Migration 008 trusted the phone's price, which let anyone who joined
-- send a turf at any price they liked. With the menu now admin-only, taking the
-- price from it makes every price something only an admin controls.
--
-- The cost is that a phone offline across a price change uploads those turfs
-- at the new price. Prices change between quarters, not mid-evening, and this
-- is a figure that ends up on an invoice.
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

  -- An item the server has not seen yet -- a new one whose menu push is still
  -- on its way -- keeps the phone's price, since there is nothing to check it
  -- against. A turf for an item that never reaches the menu counts for nothing.
  if found then
    new.price_cents := v_price;
  end if;
  return new;
end;
$$;

-- Only an admin phone may take a turf off.
drop policy if exists entries_insert on public.order_entries;
create policy entries_insert on public.order_entries
  for insert with check (
    public.is_member(session_id)
    and (delta > 0 or public.is_admin(session_id))
  );

-- ------------------------------------------------------------ policies ----

alter table public.session_admins enable row level security;

-- Every phone in a list can see who its admins are. Adding and removing goes
-- through add_admin and remove_admin, which check who is asking.
drop policy if exists admins_read on public.session_admins;
create policy admins_read on public.session_admins
  for select using (public.is_member(session_id));

-- ------------------------------------------------------------ realtime ----

alter table public.session_admins replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.session_admins;
exception when duplicate_object then null;
end $$;
