-- 022: de groep als basis, met beheerders van de groep.
--
-- Tot nu toe was een groep een laag bovenop het delen per lijst. Vanaf nu is
-- de groep het uitgangspunt: een toestel doet één keer mee met de groepscode,
-- en alle lijsten horen daarbij. Daarvoor zijn drie dingen nodig die er nog
-- niet waren.
--
--   1. Een groepsbeheerder mag een lijst van de groep verwijderen, ook als hij
--      geen beheerder van die ene lijst is. Zo kan de beheerder op zijn eigen
--      telefoon de lijsten opruimen die op de bar-iPad gemaakt zijn.
--   2. Een groepsbeheerder kan een ander toestel in de groep groepsbeheerder
--      maken, of dat weer intrekken. 019 zei al "beheerders worden via een
--      functie gemaakt", maar die functie bestond niet.
--   3. Wie de groep verlaat, is daarna ook geen groepsbeheerder meer. Tot nu
--      bleef die rij staan, en kon zo'n telefoon de ledenlijst nog wijzigen.
--
-- Wat NIET verandert: een groepsbeheerder is geen beheerder van de lijsten.
-- Turven weghalen, betalingen vastleggen, het menu en de prijzen wijzigen en een
-- lijst afsluiten blijven voorbehouden aan de beheertelefoons van die ene lijst
-- (session_admins), met hun eigen correctiecode. is_admin blijft dus zoals hij
-- is, en de bewakers uit 009 tot en met 014 ook. Alleen het verwijderen van een
-- hele lijst krijgt er een tweede soort beheerder bij.
--
-- Draai dit in de SQL-editor van het Supabase-project, na 019. Het is veilig om
-- twee keer te draaien, en het raakt niets uit 020 (lijst op slot) of 021
-- (webbeheer).

-- ------------------------------------------------- een lijst verwijderen ----

-- Een beheerder van de lijst, zoals altijd, of een beheerder van de groep waar
-- de lijst bij hoort. Een lijst zonder groep kan alleen zijn eigen beheerder
-- verwijderen.
create or replace function public.delete_session(p_session_id text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not (
    public.is_admin(p_session_id)
    or exists (
      select 1 from public.sessions s
       where s.id = p_session_id
         and s.group_id is not null
         and public.is_group_admin(s.group_id)
    )
  ) then
    raise exception 'Only an admin may delete this session';
  end if;

  -- Members, admins, people, items and order entries all cascade from here.
  delete from public.sessions where id = p_session_id;
end;
$$;

-- --------------------------------------------------- groepsbeheerders ----

-- Een ander toestel in de groep groepsbeheerder maken. Alleen een
-- groepsbeheerder mag dat, en alleen voor een toestel dat al in de groep zit:
-- zo kan niemand van buiten de groep er via een omweg in.
create or replace function public.add_group_admin(p_group_id text, p_user_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'Only a group admin may add group admins';
  end if;

  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = p_user_id
  ) then
    raise exception 'That phone is not in this group';
  end if;

  insert into public.group_admins (group_id, user_id, added_by)
  values (p_group_id, p_user_id, auth.uid())
  on conflict do nothing;
end;
$$;

-- Een groepsbeheerder intrekken, ook zichzelf. Een groep houdt er altijd minstens
-- één, anders kan niemand de ledenlijst nog wijzigen of beheerders aanwijzen.
create or replace function public.remove_group_admin(p_group_id text, p_user_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'Only a group admin may remove group admins';
  end if;

  -- Twee beheerders die elkaar tegelijk intrekken zouden er allebei nog een
  -- zien en samen niemand overlaten. De groep vergrendelen laat ze om de beurt.
  perform 1 from public.groups where id = p_group_id for update;

  if exists (
    select 1 from public.group_admins
     where group_id = p_group_id and user_id = p_user_id
  ) and (
    select count(*) from public.group_admins where group_id = p_group_id
  ) <= 1 then
    raise exception 'A group always keeps at least one admin';
  end if;

  delete from public.group_admins
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- ------------------------------------------------------ groep verlaten ----

-- Zelf de groep verlaten, en dan ook geen groepsbeheerder meer zijn.
--
-- De laatste groepsbeheerder van een groep met andere toestellen kan niet weg,
-- net als bij een lijst (013): anders blijft er een groep achter die niemand
-- meer kan beheren. Is dit het enige toestel in de groep, dan mag het wel.
create or replace function public.leave_group(p_group_id text)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_other_admins int;
  v_other_members int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if public.is_group_admin(p_group_id) then
    perform 1 from public.groups where id = p_group_id for update;

    select count(*) into v_other_admins
      from public.group_admins
     where group_id = p_group_id and user_id <> auth.uid();

    select count(*) into v_other_members
      from public.group_members
     where group_id = p_group_id and user_id <> auth.uid();

    if v_other_admins = 0 and v_other_members > 0 then
      raise exception 'last admin of this group';
    end if;

    delete from public.group_admins
     where group_id = p_group_id and user_id = auth.uid();
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Bewust geen opruiming van wie de groep al eerder verliet en nog in
-- group_admins staat: als dat de enige beheerder is, zou de groep daarna niemand
-- meer hebben die beheerders kan aanwijzen. Zie de leesquery in de README om te
-- zien of het voorkomt.
