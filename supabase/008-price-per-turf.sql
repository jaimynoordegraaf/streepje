-- 008: every turf keeps the price it was turfed at.
--
-- Until now a turf recorded only which item it was, and every total looked up
-- the item's current price. For one evening that is harmless. For a tab that
-- runs a whole season it is not: raise the price of beer in January and every
-- beer since September costs more, including quarters already invoiced.
--
-- The column is nullable on purpose. Phones still on an older app version do
-- not send a price, and must keep working while people update; the trigger
-- below fills the gap for them.

alter table public.order_entries add column if not exists price_cents integer;

-- Existing turfs get the menu price as it stands. That is the price they were
-- already being counted at, so no total changes today -- they simply stop
-- changing with the menu from here on.
update public.order_entries e
   set price_cents = i.price_cents
  from public.session_items i
 where i.id = e.item_id
   and i.session_id = e.session_id
   and e.price_cents is null;

-- A turf arriving without a price, from an older app, gets the current menu
-- price on arrival. A price the phone did send is kept: it is the price at the
-- tap, which can differ from the price at upload for a phone that was offline.
--
-- That does mean the price comes from the phone. It is not a new hole: any
-- member can already edit the menu itself. Making prices editable only by
-- admin phones is part of the next step, and is the right place to close it.
create or replace function public.fill_entry_price()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.price_cents is null then
    select i.price_cents into new.price_cents
      from public.session_items i
     where i.id = new.item_id
       and i.session_id = new.session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists order_entries_fill_price on public.order_entries;
create trigger order_entries_fill_price
  before insert on public.order_entries
  for each row execute function public.fill_entry_price();
