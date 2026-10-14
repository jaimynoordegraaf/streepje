-- 015: onder welke kolom van de penningmeester een item valt.
--
-- De kwartaalfactuur wordt bijgehouden in een spreadsheet met een vaste
-- indeling: per streeplijst een blok met Bier B, Bier SB/Wijn, Fris, Energie,
-- Chips, Snoep en Overig. Tot nu kende de app alleen drinken en eten, dus die
-- koppeling moest met de hand. Nu hoort hij bij het item zelf.
--
-- Het staat bij het menu en niet bij de turf, want het is een eigenschap van
-- wat je verkoopt. Het menu is al beheerdersgebied (guard_menu), dus wie de
-- prijzen mag zetten, mag ook dit zetten -- daar verandert niets aan.
--
-- Leeg mag: zo'n item telt in de export mee als Overig, in euro's. Dat is ook
-- waar een BBQ of het eten op een evenement terechtkomt.

alter table public.session_items add column if not exists ledger text;

alter table public.session_items drop constraint if exists session_items_ledger_check;
alter table public.session_items add constraint session_items_ledger_check
  check (ledger is null or ledger in ('bier', 'bier-speciaal', 'fris', 'energie', 'chips', 'snoep', 'overig'));
