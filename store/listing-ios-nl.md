# App Store listing (nl-NL)

Paste-ready text for App Store Connect. Character limits in brackets; the counts
in this file are measured, not estimated.

The Play listing is in `listing-nl.md`. The description is deliberately the same
text — the app is the same app, and two versions of it would only drift apart.
Everything else differs, because Apple asks for different fields.

## Name [30]

```
streepje
```

## Subtitle [30]

```
Turf wie wat drinkt en eet
```

## Promotional text [170]

Editable without submitting a new build, so this is the field to change when
there is news.

```
Nieuw: streepje werkt nu ook op de iPad, en de telefoon die deelt kan de gedeelde lijst na afloop van de server wissen.
```

## Keywords [100]

Comma separated, no spaces — a space costs a character and buys nothing. Do not
repeat the app name; Apple already indexes it.

```
turven,streepjes,bar,kantine,scouting,consumpties,drankjes,afrekenen,rekening,evenement,vereniging
```

## Description [4000]

```
streepje houdt bij wie op een evenement wat gedronken en gegeten heeft, en wie er aan het eind nog moet betalen. Gemaakt voor de bar van een scoutinggroep, waar het meestal druk is, het net traag en de administratie een bierviltje.

EEN TIK PER BESTELLING

Maak een evenement, zet erin wie er zijn, en tik. Elke tik is meteen vastgelegd. Bij de totalen zie je per persoon wat er staat en wat er nog openstaat.

WERKT ZONDER BEREIK

Alles staat op de telefoon zelf. Geen account, geen inloggen, geen wachten op een server. Valt het signaal weg, dan merk je er niets van: je turft gewoon door.

MET MEERDERE TELEFOONS TEGELIJK

Zet delen aan en de andere telefoons doen mee door een QR-code te scannen. Iedereen ziet dezelfde lopende totalen, ook als er twee mensen tegelijk een bestelling opnemen. Een telefoon die even offline is, loopt daarna vanzelf bij.

WEGHALEN KAN NIET ZOMAAR

Een turf weghalen haalt geld van iemands rekening af. Dat kan daarom alleen op de telefoon die het evenement deelt, en alleen met de correctiecode. Elke correctie blijft zichtbaar: bij de persoon, bij de totalen en in de export. Ook iemand verwijderen of het evenement weggooien zit achter die code.

BETALEN, HEEL OF EEN DEEL

Markeer iemand als betaald, of leg vast dat er een deel is afgerekend. Het restant blijft staan tot het klopt.

AAN HET EIND

Exporteer het evenement als CSV voor de penningmeester, of als korte samenvatting om in de groepsapp te plakken. Is alles afgerekend, dan kan de telefoon die deelde de gedeelde lijst van de server wissen.

WAT ER WORDT OPGESLAGEN

Zonder delen verlaat er niets de telefoon. Deel je wel, dan staan de namen en de turfjes op een server in Ierland, binnen de EU, en alleen telefoons met de code komen erbij. Geen advertenties, geen trackers, geen account.

streepje is gemaakt voor Scouting Jan Willem Friso.
```

## What's New in This Version [4000]

```
streepje werkt nu ook op de iPad, op het hele scherm en in elke stand.

De telefoon die deelt kan de gedeelde lijst na afloop van de server wissen, met de correctiecode. Elke telefoon houdt zijn eigen kopie, dus er gaat niets verloren van wat er geturfd is.

Verder een hoop kleine dingen rechtgezet in de knoppenbalk onderin en in de titelbalk.
```

## URLs

| Field | Value | Required |
| --- | --- | --- |
| Support URL | `https://jaimynoordegraaf.github.io/streepje/` | yes |
| Marketing URL | leave empty | no |
| Privacy Policy URL | `https://jaimynoordegraaf.github.io/streepje/privacy.html` | yes |

Both pages are `docs/` on master, served by GitHub Pages. Apple checks that the
support URL loads before approving, so it has to be a page rather than a mailto.

## Category, rating, copyright

- Primary category: **Productivity**
- Secondary category: **Utilities**
- Not Finance: no money moves through the app, it only counts what is owed.
- Age rating: **4+**. Every question in the questionnaire is None or No — no
  violence, no contests, no user-generated content shown to others outside the
  event, no web browsing, no gambling.
- Copyright: `2026 Scouting Jan Willem Friso`

## App Privacy

Same substance as the Play data safety answers, in Apple's vocabulary. Nothing
here is used for tracking, and nothing is linked to an identity, because the app
has no accounts to link anything to.

| Data type | Apple's category | Used for | Linked to identity | Tracking |
| --- | --- | --- | --- | --- |
| Names of participants, the event, the phone | Contact Info → Name | App Functionality | No | No |
| What each person owes and has paid | Financial Info → Other Financial Info | App Functionality | No | No |
| The app's own per-install id on each order row | Identifiers → Device ID | App Functionality | No | No |
| The anonymous sign-in id used for sharing | Identifiers → User ID | App Functionality | No | No |

Do not tick Location, Contacts, Photos, Browsing History, Usage Data or
Diagnostics. There is no analytics or crash-reporting code in the app. The
camera is used only to read a QR code; nothing from it is stored or sent.

Answer **yes** to "Do you or your third-party partners collect data from this
app?" — sharing sends the table above to Supabase. Answer **no** to tracking.

## App Review Information

- Sign-in required: **no**. Leave the demo account fields empty.
- Contact: your name, phone number and `meco@scoutingjwf.nl`.
- Notes:

```
streepje is a tally app for the bar at a Scouting group's events. It counts who
has had which drinks and food, and what each person still owes.

No account and no sign-in. Everything works on one device with no network.

To try the optional sharing: create an event, add a few people, then Delen ->
Delen starten. A second device joins by scanning the QR code or typing the
six-character code. Both devices then see the same running totals.

Removing a tally is deliberately restricted: it is only possible on the device
that started sharing, and only with a numeric code chosen when the event is set
up. This is a safeguard, not a paywall or a locked feature.

The app and its CSV export are in Dutch, as its users are.
```

## Screenshots

Required sets, because the app supports both device families:

| Device family | Size | How many |
| --- | --- | --- |
| iPhone 6.9" | 1320 × 2868 (or 1290 × 2796) | 3–10 |
| iPad 13" | 2064 × 2752 (or 2048 × 2732) | 3–10 |

Take them from the TestFlight build on a real device, with a made-up event so no
real names are shown. The same six shots work for both families:

1. The event screen with five or six people and running totals
2. One person's screen mid-tally, showing the + and − buttons
3. The totals screen, with someone marked paid and someone still owing
4. The share screen with the QR code
5. The correction code prompt, to show removals are guarded
6. The setup screen with the menu

Four or five tells the story; three is the minimum worth submitting.
