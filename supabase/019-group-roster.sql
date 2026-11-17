-- 019: de ledenlijst van de groep.
--
-- Tot nu stonden de leden op de lopende rekening (gedeeld) en de Vaste namen op
-- één toestel (nergens gedeeld). Dit is één lijst voor de hele groep, waaruit de
-- barploeg kiest in plaats van te typen.
--
-- Wie mag wat:
--   lezen         elke telefoon in de groep (is_group_member), want die moet
--                 de namen kunnen kiezen;
--   schrijven     alleen een beheerder van de groep (is_group_admin). Dat is de
--                 telefoon die de groep maakte, en wie die er verder bij zet.
--
-- De regel staat in de database, niet alleen in de app: een lid-telefoon die
-- rechtstreeks naar de tabel schrijft wordt geweigerd. Er staan alleen namen en
-- speltakken in. Geen telefoonnummers of adressen.
--
-- Een naam wordt nooit echt verwijderd uit de lijst maar gemarkeerd (removed_at),
-- zoals iemand op een lijst: wat er al op rekeningen staat blijft kloppen, en een
-- naam die terugkomt wordt teruggezet in plaats van een tweede keer aangemaakt.
--
-- Draai dit in de SQL-editor van het Supabase-project, nadat 014 en schema.sql
-- zijn gedraaid. Het is veilig om twee keer te draaien.

-- ------------------------------------------------------------ beheerders ----

create table if not exists public.group_admins (
  group_id    text not null references public.groups(id) on delete cascade,
  user_id     uuid not null,
  added_by    uuid,
  added_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Wie een groep al gemaakt had is er beheerder van.
insert into public.group_admins (group_id, user_id)
select id, created_by from public.groups where created_by is not null
on conflict do nothing;

create or replace function public.is_group_admin(p_group_id text)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.group_admins a
    where a.group_id = p_group_id and a.user_id = auth.uid()
  );
$$;

-- Een nieuwe groep krijgt zijn maker meteen als beheerder.
create or replace function public.create_group(p_id text, p_name text, p_join_code text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.groups (id, name, join_code, created_by)
  values (p_id, p_name, upper(p_join_code), auth.uid());

  insert into public.group_members (group_id, user_id)
  values (p_id, auth.uid());

  insert into public.group_admins (group_id, user_id, added_by)
  values (p_id, auth.uid(), auth.uid());
end;
$$;

-- ----------------------------------------------------- speltakken en leden ----

create table if not exists public.group_sections (
  id          text primary key,
  group_id    text not null references public.groups(id) on delete cascade,
  name        text not null
);

create table if not exists public.group_roster (
  id          text primary key,
  group_id    text not null references public.groups(id) on delete cascade,
  name        text not null,
  section_id  text references public.group_sections(id) on delete set null,
  removed_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Dezelfde naam kan niet twee keer in een groep staan, ook niet als hij eerder is
-- weggehaald: wie terugkomt wordt teruggezet. Hoofdletters en dubbele spaties
-- tellen niet mee; accenten wel, die kent de app (zie nameKey) maar niet elke
-- Postgres.
create unique index if not exists group_roster_name_unique
  on public.group_roster (group_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

create unique index if not exists group_sections_name_unique
  on public.group_sections (group_id, lower(btrim(name)));

create index if not exists group_roster_group_idx on public.group_roster (group_id);

-- Een speltak van een andere groep kan niet aan een lid van deze gehangen worden.
create or replace function public.guard_roster()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.section_id is not null and not exists (
    select 1 from public.group_sections s
     where s.id = new.section_id and s.group_id = new.group_id
  ) then
    new.section_id := null;
  end if;
  if tg_op = 'UPDATE' then
    new.group_id := old.group_id;
  end if;
  return new;
end;
$$;

drop trigger if exists group_roster_guard on public.group_roster;
create trigger group_roster_guard
  before insert or update on public.group_roster
  for each row execute function public.guard_roster();

-- ------------------------------------------------------------- toegang ----

alter table public.group_admins   enable row level security;
alter table public.group_sections enable row level security;
alter table public.group_roster   enable row level security;

drop policy if exists group_admins_read on public.group_admins;
create policy group_admins_read on public.group_admins
  for select using (public.is_group_member(group_id));

-- Er is bewust geen schrijfbeleid op group_admins: beheerders worden via een
-- functie gemaakt, niet door rechtstreeks in de tabel te schrijven.

drop policy if exists group_sections_read on public.group_sections;
create policy group_sections_read on public.group_sections
  for select using (public.is_group_member(group_id));
drop policy if exists group_sections_write on public.group_sections;
create policy group_sections_write on public.group_sections
  for all using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

drop policy if exists group_roster_read on public.group_roster;
create policy group_roster_read on public.group_roster
  for select using (public.is_group_member(group_id));
drop policy if exists group_roster_write on public.group_roster;
create policy group_roster_write on public.group_roster
  for all using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

-- -------------------------------------------------- koppeling met een lijst ----

-- Welke naam uit de ledenlijst deze persoon op een lijst is. Leeg voor wie er
-- niet uit komt: een gast, of iemand van voor de ledenlijst. Matched op id,
-- nooit op naam, om dezelfde reden als member_id.
alter table public.session_people add column if not exists roster_id text;

-- ------------------------------------------------------------- realtime ----

alter table public.group_sections replica identity full;
alter table public.group_roster   replica identity full;
alter table public.group_admins   replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.group_sections;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.group_roster;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.group_admins;
exception when duplicate_object then null;
end $$;
