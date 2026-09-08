-- Record how much someone has actually paid, not just whether they have.
--
-- Run this once in the Supabase dashboard -> SQL Editor -> Run.
--
-- People hand over round numbers against odd totals, so a yes/no flag could
-- not describe ten euro against thirteen fifty. The existing `paid` column is
-- kept and still written, so nothing that reads it breaks, but paid_cents is
-- what the app now works from.

alter table public.session_people
  add column if not exists paid_cents integer not null default 0;

-- Anyone already marked paid owed nothing at the time, so carry that across
-- rather than resetting them to unpaid.
update public.session_people
   set paid_cents = 0
 where paid_cents is null;
