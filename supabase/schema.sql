-- Turf: shared session storage.
-- Paste this whole file into the Supabase dashboard -> SQL Editor -> Run.

-- ---------------------------------------------------------------- tables ---

create table if not exists public.sessions (
  id          text primary key,
  join_code   text not null unique,
  name        text not null,
  closed      boolean not null default false,
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

create table if not exists public.session_people (
  id          text primary key,
  session_id  text not null references public.sessions(id) on delete cascade,
  name        text not null,
  paid        boolean not null default false,
  paid_cents  integer not null default 0,
  removed_at  timestamptz,
  removed_by  text,
  paid_at     timestamptz
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

-- Is the caller the host of this session? Only the host may remove a turf.
create or replace function public.is_host(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.host_id = auth.uid()
  );
$;

-- Creating a session also makes the creator its first member, in one step.
create or replace function public.create_session(p_id text, p_join_code text, p_name text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.sessions (id, join_code, name, host_id)
  values (p_id, upper(p_join_code), p_name, auth.uid());

  insert into public.session_members (session_id, user_id)
  values (p_id, auth.uid());
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

-- ------------------------------------------------------------- policies ----

alter table public.sessions        enable row level security;
alter table public.session_members enable row level security;
alter table public.session_people  enable row level security;
alter table public.session_items   enable row level security;
alter table public.order_entries   enable row level security;

drop policy if exists sessions_rw on public.sessions;
create policy sessions_rw on public.sessions
  for all using (public.is_member(id)) with check (public.is_member(id));

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
    and (delta > 0 or public.is_host(session_id))
  );

-- ------------------------------------------------------------- realtime ----

alter table public.sessions        replica identity full;
alter table public.session_members replica identity full;
alter table public.session_people replica identity full;
alter table public.session_items  replica identity full;
alter table public.order_entries  replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.sessions;
  alter publication supabase_realtime add table public.session_members;
  alter publication supabase_realtime add table public.session_people;
  alter publication supabase_realtime add table public.session_items;
  alter publication supabase_realtime add table public.order_entries;
exception when duplicate_object then null;
end $$;
