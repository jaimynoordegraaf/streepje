# streepje

Turf wie wat gedronken en gegeten heeft op een evenement, en wie er aan het eind
nog moet betalen.

An Android app in the streepje house style. The interface and the CSV export are
in Dutch; the code and this file are in English.

- **Local first.** Everything works with no signal and no account. Tapping a
  drink writes to the phone, and nothing waits on a network.
- **Optionally shared.** Turn sharing on and other phones join by scanning a QR
  code, so several people can take orders at once and everyone sees the same
  running totals. Off by default.
- **Exportable.** Any event becomes a CSV you can open in Excel, or a short text
  summary you can paste into WhatsApp.

## Running it in development

```
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Then scan the QR code with **Expo Go** on an Android phone. `start.ps1` exists
because plain `npx expo start` picks the wrong network adapter on a machine with
VMware or similar installed — it advertises a virtual address the phone cannot
reach. The script reads the interface that actually holds the default route and
pins Expo to it.

If the phone still cannot connect — a guest network, or a firewall blocking
port 8081 — route it through Expo's relay instead:

```
npx expo start --tunnel
```

## Sharing across devices

Sharing needs a Supabase project. Without one the app is fully usable, it just
stays on a single phone and the sharing screens say so rather than failing.

Setup is a one-off: an account, one SQL script, and two lines in a `.env` file.
It is written up in **[supabase/README.md](supabase/README.md)**, with the schema
in [supabase/schema.sql](supabase/schema.sql).

Once configured: **event → Delen → Delen starten** shows a QR code and a
six-character code. On the other phone, **Deelnemen** on the events list.

## How it fits together

```
src/
  app/                       screens (the folder layout IS the navigation)
    index.tsx                  list of events
    join.tsx                   scan a QR code to join a shared session
    settings.tsx               the default menu new events start from
    event/[id]/
      index.tsx                one event: everyone and their running total
      person/[personId].tsx    tap +/- to count someone's drinks and food
      totals.tsx               totals, marking people paid, exporting
      setup.tsx                rename, people, this event's menu, delete
      share.tsx                QR code, join code, connection status

  lib/
    types.ts       what the data looks like
    store.ts       all the data and every way it can change (saved automatically)
    totals.ts      the sums; pure functions, no screen or storage involved
    money.ts       cents to text and back
    export.ts      CSV file and text summary
    supabase.ts    the database connection, dormant without credentials
    sync.ts        pushing and pulling a shared session
    use-sync.ts    keeps one event in step while a screen is open

  components/      reusable interface pieces
  theme.ts         brand colours and spacing, light and dark

supabase/          schema and setup guide for sharing
watch-session.mjs  inspect a live session from outside the app
```

## Decisions worth knowing before you change anything

**Money is stored in whole cents.** `2,50` is kept as `250`. Decimals in a
computer are approximations, so repeatedly adding `0.1` drifts away from the
true value. Integers stay exact.

**Orders are an append-only log, not a running count.** Every tap writes its own
row (`+1 Bier for Anne, from device B, 21:34`) and a total is the sum of the
rows. A correction is a row too, with delta `-1`.

This is the load-bearing decision. If two phones each held a count, both could
read "3 beers", both write "4", and one order would vanish with no trace. Because
every tap is a separate row, two phones can log the same drink in the same
instant and neither can overwrite the other. The database enforces it as well:
`order_entries` has insert and select policies and deliberately **no update or
delete policy**, so even a broken client cannot rewrite history.

Verified on two phones: 140 near-simultaneous taps on the same item from
different devices, every one preserved, no duplicated rows.

Do not "simplify" this back into stored counts.

**Each event owns a copy of the menu.** Changing the price of beer today does not
rewrite what people owed at a party last month.

**People, prices and paid status are last-edit-wins.** Unlike orders, these are
edited rather than appended. Two people renaming the same person in the same
second means one edit wins. Acceptable, because that is setup work done before an
event rather than during it.

**Brand colours are adjusted for contrast.** The streepje sheet notes that its
pale tints need black text "voor betere leesbaarheid". Measured, the full
strength colours need it too: behind white text the orange reaches only 3.37
contrast and the blue 2.55, against the 4.5 small text needs; behind black they
are fine at 5.37 and 7.10. So brand colours are used as **surfaces carrying dark
text**, never as a bed for white text — which is why filled buttons are orange
with a near-black label.

Those same colours also fail as small text on white, so anything that is text
rather than a surface uses a deepened tone: `link` and `good` are `#1F6FA8`,
`danger` is `#C8410F`. The bright orange still appears at full strength where it
is a large glyph or a filled button. Every pairing in `theme.ts` is checked
against WCAG AA — check any new one before adding it.

**Type is Montserrat on a golden-ratio scale**, as the sheet specifies: 15 → 24 →
39, each step 1.618 times the last, with the display face in bold italic to match
the logotype. `small` (12) sits off the scale deliberately; continuing downwards
gives 9.3pt, too small to read at arm's length in a dim bar.

## Building an installable APK

No Android Studio needed; Expo builds it in the cloud.

```
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

That returns a download link for an `.apk`. Android warns about installing
outside the Play Store, which is expected for your own app.

The build compiles Expo's Android modules **from source** rather than downloading
prebuilt `.aar` files, via `EXPO_USE_PRECOMPILED_MODULES=0` in `eas.json` and
`expo.autolinking.android.buildFromSource` in `package.json`. Maven Central
rate-limited the build machines (HTTP 429) and no build could resolve its
dependencies. Building from source is slower — roughly 30–40 minutes — but does
not depend on that repository being reachable. If builds are healthy again and
you want the speed back, remove both settings.

Credentials reach the build through `env` in `eas.json` rather than `.env`, since
gitignored files are not uploaded. The publishable key living there is fine: it
is compiled into the APK regardless, and row-level security is what protects the
data. Never put a `sb_secret_` key there.

## Inspecting a live session

```
node watch-session.mjs R4MZE9
```

Joins a shared session with its six-character code and prints per-person totals
and recent order rows straight from the database, refreshing as they arrive. Use
it to answer "did that order actually reach the server?" without trusting either
phone's screen.

## Things that bit us

- **Android draws behind the navigation bar.** Edge-to-edge is on by default from
  SDK 54, so any bottom bar needs `useBottomInset()` from `components/ui.tsx` or
  it hides under the system buttons.
- **Custom fonts ignore `fontWeight` on Android.** Each weight is its own family,
  which is why all text goes through `components/text.tsx` rather than React
  Native's `Text`.
- **Montserrat is loaded by exact file path.** Importing from the package index
  pulls all 18 weights, and one unresolved file among them breaks the bundle.
- **A closed `Modal` leaves its backdrop painted on web,** so closed modals are
  unmounted rather than merely hidden.
- **Node may be missing from a shell's PATH on Windows** even when installed.
  It lives in `C:\Program Files\nodejs`; check there before concluding it is absent.
