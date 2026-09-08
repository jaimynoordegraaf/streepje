-- Removing a person or a menu item must not destroy what they had.
--
-- Run this once in the Supabase dashboard -> SQL Editor -> Run.
--
-- Removing a person used to delete their turfs, and removing a menu item used
-- to delete every turf logged against it. Both erased money with no PIN, no
-- host check, and nothing left behind to notice -- which defeated the point of
-- guarding the removal of a single turf.
--
-- Nothing is deleted now. A person is marked as removed, keeping their entries
-- and recording which phone did it. An item is hidden, keeping its price so
-- turfs already logged against it still count.

alter table public.session_people
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by text;

alter table public.session_items
  add column if not exists hidden boolean not null default false;
