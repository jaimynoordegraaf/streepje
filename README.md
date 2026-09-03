# Streeplijst

Keep track of what everyone drank and ate at an event, and who still owes money.

Everything is stored **on the phone only** — no account, no server, no internet needed.
Use the CSV export when you want a record you can check outside the app.

## Running it

```
npx expo start
```

Then scan the QR code with the **Expo Go** app on your Android phone
(phone and PC must be on the same Wi-Fi).

If the phone cannot reach the PC — common with a guest network or a strict
firewall — start it through Expo's relay instead:

```
npx expo start --tunnel
```

## How it fits together

```
src/
  app/                     screens (the folder layout IS the navigation)
    index.tsx                list of events
    settings.tsx             the default menu new events start from
    event/[id]/
      index.tsx              one event: everyone and their running total
      person/[personId].tsx  tap +/- to count someone's drinks and food
      totals.tsx             totals, marking people paid, exporting
      setup.tsx              rename, people, this event's menu, delete

  lib/
    types.ts     what the data looks like
    store.ts     all the data and every way it can change (saved automatically)
    totals.ts    the sums; pure functions, no screen or storage involved
    money.ts     cents to text and back
    export.ts    CSV file and text summary

  components/    reusable bits of interface
  theme.ts       colours and spacing, light and dark
```

## Two decisions worth knowing

**Money is stored in whole cents.** `2.50` is kept as `250`. Decimals in a
computer are approximations, so repeatedly adding `0.1` drifts away from the
true value. Integers stay exact.

**Each event owns a copy of the menu.** Changing the price of beer today does
not rewrite what people owed at a party last month.

## Building an installable APK later

No Android Studio required — Expo builds it in the cloud:

```
npx expo install expo-dev-client   # only if you add libraries Expo Go lacks
npm install -g eas-cli
eas build --platform android --profile preview
```

That returns a download link for an `.apk` you can install on any Android phone.
