-- 017: ideeën insturen vanuit de app.
--
-- De mensen die achter de bar staan bedenken de verbeteringen, niet degene die
-- de app bouwt. Tot nu moest dat via een appje of mondeling, en dan zakt het
-- weg. Een idee hoort bij de groep: de hele barploeg ziet wat er is ingestuurd,
-- zodat niemand hetzelfde twee keer bedenkt en iedereen ziet dat er iets mee
-- gebeurt.
--
-- Wie het instuurde staat erbij als telefoonnaam, niet als persoon: de app
-- kent geen namen, alleen telefoons. Versie en platform gaan mee omdat het
-- scheelt bij "dat knopje doet het niet".
--
-- Een idee staat vast zodra het er is -- er is geen update-policy. Wel mag je
-- je eigen inzending terugtrekken; een vergissing hoeft niet eeuwig te blijven
-- staan.

create table if not exists public.ideas (
  id           text primary key,
  group_id     text references public.groups(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  device_name  text,
  app_version  text,
  platform     text,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists ideas_group_idx on public.ideas (group_id, created_at desc);

alter table public.ideas enable row level security;

-- Insturen mag iedereen die is aangemeld, maar alleen op eigen naam en alleen
-- in een groep waar je zelf in zit. Zonder groep is het een idee dat alleen de
-- inzender terugziet.
drop policy if exists ideas_insert on public.ideas;
create policy ideas_insert on public.ideas
  for insert with check (
    created_by = auth.uid()
    and (group_id is null or public.is_group_member(group_id))
  );

drop policy if exists ideas_read on public.ideas;
create policy ideas_read on public.ideas
  for select using (
    created_by = auth.uid()
    or (group_id is not null and public.is_group_member(group_id))
  );

drop policy if exists ideas_delete_own on public.ideas;
create policy ideas_delete_own on public.ideas
  for delete using (created_by = auth.uid());
