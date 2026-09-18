-- 013: stoppen met delen betekent ook echt weg zijn uit de lijst.
--
-- "Stoppen met delen op deze telefoon" zette het alleen lokaal uit. De rij in
-- session_members bleef staan, dus bij de andere telefoons bleef dit toestel
-- onder Delen in de lijst met deelnemers staan, alsof het nog meedeed.
--
-- Een telefoon mag zichzelf nu verwijderen, maar alleen zichzelf: er is
-- bewust geen delete-policy op de tabel, zodat niemand een ander uit een lijst
-- kan gooien. Dat loopt via deze functie, die kijkt wie het vraagt.
--
-- De ene uitzondering: de laatste beheerder van een lijst met andere
-- deelnemers kan niet weg. Anders blijft een lijst achter die niemand meer kan
-- corrigeren. Is die telefoon de enige deelnemer, dan mag het wel -- er is dan
-- niemand meer die iets aan die lijst heeft.

create or replace function public.leave_session(p_session_id text)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_other_admins int;
  v_other_members int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Al vertrokken, of nooit lid geweest: niets te doen.
  if not public.is_member(p_session_id) then
    return;
  end if;

  if public.is_admin(p_session_id) then
    -- Twee beheerders die tegelijk vertrekken zouden er allebei nog een zien
    -- en samen niemand overlaten. De lijst vergrendelen laat ze om de beurt.
    perform 1 from public.sessions where id = p_session_id for update;

    select count(*) into v_other_admins
      from public.session_admins
     where session_id = p_session_id and user_id <> auth.uid();

    select count(*) into v_other_members
      from public.session_members
     where session_id = p_session_id and user_id <> auth.uid();

    if v_other_admins = 0 and v_other_members > 0 then
      raise exception 'last admin of this session';
    end if;

    delete from public.session_admins
     where session_id = p_session_id and user_id = auth.uid();
  end if;

  delete from public.session_members
   where session_id = p_session_id and user_id = auth.uid();
end;
$$;
