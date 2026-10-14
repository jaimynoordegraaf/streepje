-- 016: een vrije toevoeging achter de naam van een persoon.
--
-- Gasten komen vaak van een andere groep, en de penningmeester wil in zijn
-- kwartaalblok naast de naam zien waar iemand bij hoort. Tot nu was daar geen
-- plek voor: een gast heette "Lisa" en verder niets.
--
-- Bewust vrije tekst en bewust géén contactgegevens. Elke telefoon die aan een
-- gedeelde lijst meedoet kan alles lezen, dus een telefoonnummer of adres hoort
-- hier niet; dat gaat buiten de app om naar de penningmeester.
--
-- Net als de naam mag iedereen die meedoet dit zetten -- het is geen geld.
-- guard_people laat name al vrij en doet met deze kolom hetzelfde.

alter table public.session_people add column if not exists note text;
