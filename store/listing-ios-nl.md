# App Store listing (nl-NL)

Paste-ready text for App Store Connect. Character limits in brackets. Written for 1.0.3:
season tab, members and guests, admin phones, closing events, and over-the-air updates.

The Play listing is in `listing-nl.md`. The description is deliberately the same
text — the app is the same app, and two versions of it would only drift apart.
Everything else differs, because Apple asks for different fields.

## Name [30]

```
streepje
```

## Subtitle [30]

```
Turven en afrekenen aan de bar
```

## Promotional text [170]

Editable without submitting a new build, so this is the field to change when
there is news.

```
Turf wie wat drinkt en eet, op één telefoon of samen op meerdere. Voor losse evenementen én de lopende rekening van het hele seizoen.
```

## Keywords [100]

Comma separated, no spaces — a space costs a character and buys nothing. Do not
repeat the app name; Apple already indexes it.

```
turven,turflijst,bar,scouting,drankjes,rekening,afrekenen,bestellingen,vereniging,kantine,betalen
```

## Description [4000]

```
streepje houdt bij wie wat gedronken en gegeten heeft, en wie daarvoor betaalt. Gemaakt voor de bar van een scoutinggroep, waar het meestal druk is, het bereik slecht en de administratie een bierviltje.

EEN TIK PER BESTELLING
Tik op een naam en daarna op wat iemand neemt. Elke tik is meteen vastgelegd, met de prijs van dat moment. Neemt een groep een rondje, dan kies je het drankje één keer en vink je de namen aan.

DE LOPENDE REKENING
Voor de gewone baravonden houd je één lijst bij voor het hele seizoen. Niemand hoeft aan de bar te betalen: de penningmeester stuurt de leden per kwartaal een factuur.

EVENEMENTEN MET LEDEN EN GASTEN
Voor een feest of een weekend weg maak je een evenement. Leden haal je in één keer uit de lopende rekening, en wat zij nemen gaat op de factuur. Gasten betalen aan het eind van de avond, bijvoorbeeld met een betaalverzoek, of gaan ook op de factuur. Een evenement kan zijn eigen prijzen hebben.

MET MEERDERE TELEFOONS TEGELIJK
Deel een lijst en de andere telefoons doen mee door een QR-code te scannen of een code in te typen. Iedereen ziet dezelfde lopende totalen, ook als er twee mensen tegelijk een bestelling opnemen.

WERKT ZONDER BEREIK
Alles staat op de telefoon zelf. Valt het signaal weg, dan turf je gewoon door. Zodra er weer verbinding is, loopt de telefoon vanzelf bij.

WEGHALEN KAN NIET ZOMAAR
Een turfje weghalen haalt geld van iemands rekening. Dat kan alleen op een beheertelefoon en alleen met de correctiecode, en elke correctie blijft zichtbaar in de totalen en de export. Ook betalingen vastleggen, het menu en de prijzen aanpassen en een evenement afsluiten kan alleen op een beheertelefoon. Een lijst kan meerdere beheerders hebben.

AAN HET EIND
Leg vast wie betaald heeft, helemaal of voor een deel. Sluit het evenement af zodat er niets meer bij komt, en exporteer de afrekening als CSV voor de penningmeester.

WAT ER WORDT OPGESLAGEN
Zonder delen verlaat er niets de telefoon. Deel je een lijst, dan staan de namen en de turfjes op een server in Ierland, binnen de EU, en alleen telefoons met de code komen erbij. Geen account, geen advertenties, geen trackers.

Kleine verbeteringen komen automatisch binnen. Werkt op iPhone en iPad.

streepje is gemaakt voor Scouting Jan Willem Friso.
```

## What's New in This Version [4000]

App Store Connect only shows this field from the second App Store version on; the
first release goes out without it. Write it for the version after 1.0.3. Changes
that arrive as an over-the-air update never pass through here.

## URLs

| Field | Value | Required |
| --- | --- | --- |
| Support URL | `https://scoutingjwf.nl/streepje/` | yes |
| Marketing URL | leave empty | no |
| Privacy Policy URL | `https://scoutingjwf.nl/streepje/privacy/` | yes |

Both are pages on scoutingjwf.nl, with a quick start guide at
`https://scoutingjwf.nl/streepje/uitleg/`. The old GitHub Pages copies in `docs/`
only redirect there now. Apple checks that the support URL loads before approving,
so it has to be a page rather than a mailto. Use the same privacy URL in Play
Console.

## Category, rating, copyright

- Primary category: **Productivity**
- Secondary category: **Utilities**
- Not Finance: no money moves through the app, it only records what is owed and paid.
- Age rating: answer Apple's questionnaire as it is. The alcohol question applies —
  the app is a tally for a bar, and beer is on the menu — which is what put the Play
  rating at PEGI 18. Everything else is None or No: no violence, no contests, no
  gambling, no web browsing, no user-generated content shown outside a list.
- Copyright: `2026 Scouting Jan Willem Friso`

## App Privacy

Same substance as the Play data safety answers, in Apple's vocabulary. Nothing
here is used for tracking, and nothing is linked to an identity, because the app
has no accounts to link anything to.

| Data type | Apple's category | Used for | Linked to identity | Tracking |
| --- | --- | --- | --- | --- |
| Names of participants, the list, the phone | Contact Info → Name | App Functionality | No | No |
| What each person owes and has paid, and how they pay | Financial Info → Other Financial Info | App Functionality | No | No |
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
- Notes, in English since the reviewer may not read Dutch:

```
streepje is a drink and food tally for the bar of a scouting group (Scouting Jan Willem Friso, the Netherlands). The interface is in Dutch; the steps below name the Dutch buttons.

No account or sign-in is needed, and everything can be tested on a single device.

Testing on one device:
1. On the home screen tap "Nieuw", keep "Evenement" selected, type any name and tap "Aanmaken". The event starts with a default menu of drinks and food.
2. Tap "Gast", type a name and tap "Toevoegen". Add a second guest the same way.
3. Tap a guest's name, then tap the check mark next to a drink to tally it. The running total is shown at the top.
4. Tap the cross next to a drink to remove a tally. The first time, the app asks you to choose a 4-digit correction code (any code works); removals always require that code.
5. Go back and tap "Totalen" to see what everyone owes, record a payment, and export the list with "CSV-bestand exporteren".
6. "Beheer" (top right of the event) holds the menu and prices, and "Evenement afsluiten" to close the event. Reopening asks for the correction code.

Sharing between devices (optional, needs a second device): on the event screen tap the bar that reads "Alleen op deze telefoon", then "Delen starten", and enter a name for the device. A QR code and a 6-character code appear. On the second device tap "Deelnemen" on the home screen, enter a device name, and scan the QR code or tap "Code intypen". Both devices then show the same tallies. The camera is used only to scan this QR code.

No money moves through the app. Payments happen outside it (for example a bank payment request) and are only recorded here. There are no in-app purchases, ads, or tracking. Shared lists are stored in a database in the EU (Ireland) under an anonymous session, without personal accounts.

The menu includes alcoholic drinks; the app is meant for the adult volunteers who run the bar. Help and privacy pages: https://scoutingjwf.nl/streepje/
```

## Screenshots

Required sets, because the app supports both device families:

| Device family | Size | How many |
| --- | --- | --- |
| iPhone 6.9" | 1320 × 2868 (or 1290 × 2796) | 3–10 |
| iPad 13" | 2064 × 2752 (or 2048 × 2732) | 3–10 |

Take them from the TestFlight build on a real device, with a made-up event so no
real names are shown. The same shots work for both families:

1. The event screen with five or six people and running totals
2. One person's screen mid-tally, showing the check and cross buttons
3. The totals screen, with a guest marked paid and one still owing
4. The share screen with the QR code
5. The correction code prompt, to show removals are guarded
6. The season tab, to show members going onto the invoice

Four or five tells the story; three is the minimum worth submitting.
