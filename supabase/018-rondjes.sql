-- 018: een rondje geven.
--
-- Bij een rondje betaalt één persoon, de gever, voor drankjes van anderen. De
-- regels zelf staan op de gever (person_id), een plus één per drankje, zodat de
-- rekening klopt zonder dat iemand anders een regel van nul euro erbij krijgt.
-- Twee optionele kolommen onthouden voor wie het drankje was en bij welk rondje
-- het hoort, zodat het logboek er één regel van kan maken en de telling
-- "wat dronk iemand" klopt.
--
-- Beide mogen leeg zijn: een gewone turf heeft ze niet, en een telefoon die
-- nog niet is bijgewerkt kent ze niet. Die rekent het geld toch goed uit, want
-- het blijft een plus één op de gever.
--
-- Draai dit VOORDAT de app met het rondje naar de telefoons gaat. De app
-- stuurt de twee velden alleen mee bij een rondje, dus gewone turfregels
-- breken niet als deze kolommen er nog niet zijn, maar een rondje komt dan
-- pas aan zodra ze er zijn.

alter table public.order_entries add column if not exists for_person_id text;
alter table public.order_entries add column if not exists round_id text;

create index if not exists order_entries_round_idx
  on public.order_entries (session_id, round_id)
  where round_id is not null;
