-- 014: groepen, zodat de barploeg niet elke lijst apart hoeft te scannen.
--
-- Tot nu is een lijst privé en is de code de sleutel. Dat werkt voor één avond,
-- maar niet voor een barploeg die elk seizoen tientallen lijsten langs ziet
-- komen: elke nieuwe lijst moest apart gedeeld en gescand worden.
--
-- Een groep is een laag erboven. Telefoons scannen één keer de groepscode en
-- zijn daarmee lid van de groep. Lijsten die bij die groep horen, mogen ze
-- lezen en in turven alsof ze eraan deelnemen -- dat gaat via is_member, dus
-- elke bestaande policy volgt vanzelf.
--
-- Wat NIET verandert: corrigeren, betalingen vastleggen, het menu wijzigen, een
-- lijst afsluiten of verwijderen blijft voorbehouden aan beheertelefoons van
-- die ene lijst (session_admins). Lid van de groep zijn maakt je geen beheerder.
--
-- De keerzijde, bewust gekozen: wie de groepscode heeft, kan bij alles van de
-- groep. Iemand de toegang ontnemen betekent de code vervangen en de rest
-- opnieuw laten scannen. Dat is de prijs voor een app zonder inloggen.

create table if not exists public.groups (
  id          text primary key,
  name        text not null,
  join_code   text not null unique,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create table if not exists public.group_members (
  group_id    text not null references public.groups(id) on delete cascade,
  user_id     uuid not null,
  name        text,
  joined_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Een lijst hoort bij hooguit één groep. Blijft leeg voor lijsten die iemand
-- gewoon met een code deelt; die blijven werken zoals ze deden.
alter table public.sessions add column if not exists group_id text references public.groups(id);
create index if not exists sessions_group_idx on public.sessions (group_id);

create or replace function public.is_group_member(p_group_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.group_members g
    where g.group_id = p_group_id and g.user_id = auth.uid()
  );
$$;

-- Lid van een lijst, of lid van de groep waar die lijst bij hoort. Alle policies
-- hangen hieraan, dus dit ene punt opent de lijsten voor de barploeg zonder dat
-- er elders iets hoeft te veranderen.
create or replace function public.is_member(p_session_id text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = auth.uid()
  ) or exists (
    select 1
      from public.sessions s
      join public.group_members g on g.group_id = s.group_id
     where s.id = p_session_id and g.user_id = auth.uid()
  );
$$;

-- Een groep aanmaken. De maker is meteen lid.
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
end;
$$;

-- Deelnemen met de groepscode. De enige manier om in een groep te komen.
create or replace function public.join_group(p_join_code text)
returns text language plpgsql security definer
set search_path = public as $$
declare
  v_id text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select id into v_id from public.groups where join_code = upper(p_join_code);
  if v_id is null then
    raise exception 'No group with that code';
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end;
$$;

-- Zelf de groep verlaten. Alleen zichzelf, net als bij een lijst.
create or replace function public.leave_group(p_group_id text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Een lijst bij een groep zetten mag alleen een beheerder van die lijst, alleen
-- als de lijst nog bij geen enkele groep hoort, en alleen bij een groep waar de
-- beheerder zelf in zit. Daarna ligt het vast: een lijst verhuizen zou hem
-- ongemerkt voor een andere ploeg openzetten.
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

  if new.group_id is distinct from old.group_id then
    if old.group_id is null
       and new.group_id is not null
       and public.is_admin(old.id)
       and public.is_group_member(new.group_id) then
      null; -- toegestaan
    else
      new.group_id := old.group_id;
    end if;
  end if;

  if not public.is_admin(old.id) then
    new.closed := old.closed;
  end if;
  if new.kind = 'tab' then
    new.closed := false;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------- policies ----

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (public.is_group_member(id));

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members
  for select using (public.is_group_member(group_id));

-- Een telefoon mag zichzelf een naam geven in de groep, en alleen zichzelf.
drop policy if exists group_members_name_own on public.group_members;
create policy group_members_name_own on public.group_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Aanmaken, deelnemen en verlaten gaan via de functies hierboven, die kijken
-- wie het vraagt. Daarom bewust geen insert- of delete-policy.

-- ------------------------------------------------------------- realtime ----

alter table public.groups        replica identity full;
alter table public.group_members replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.groups;
  alter publication supabase_realtime add table public.group_members;
exception when duplicate_object then null;
end $$;
