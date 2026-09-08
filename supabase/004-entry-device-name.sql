-- Record which phone logged each order, by name.
--
-- Run this once in the Supabase dashboard -> SQL Editor -> Run.
--
-- order_entries already carries device_id, but that is an id generated on the
-- phone and means nothing to a reader. The name is stored alongside it, as it
-- stood when the row was written: order_entries has no update policy, so a
-- device renaming itself later cannot rewrite what it did earlier. That is the
-- point of keeping it here rather than joining to session_members.

alter table public.order_entries
  add column if not exists device_name text;
