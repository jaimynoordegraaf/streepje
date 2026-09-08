# Turning on multi-device sharing

Until you do this, the app works exactly as before: everything stays on one
phone, and the Share screen explains that sharing is not set up. Nothing here
is needed to keep using streepje on its own.

You need to do this once. Steps 1-3 are things only you can do -- they involve
creating an account, which I can't do on your behalf.

## 1. Create the project

1. Go to https://supabase.com and sign up (free tier is plenty -- this app
   stores a few kilobytes per event).
2. Create a new project. Pick the region closest to you (Frankfurt or London
   for the Netherlands). Save the database password somewhere safe; you will
   not need it for this app, but you cannot recover it later.
3. Wait for the project to finish provisioning, about two minutes.

## 2. Allow anonymous sign-in

Each phone signs itself in silently so the database can tell devices apart.
Nobody types a password, and no email is collected.

- Go to **Authentication -> Sign In / Providers**
- Turn on **Anonymous sign-ins** and save

## 3. Create the tables

- Go to **SQL Editor -> New query**
- Paste the entire contents of `schema.sql` (next to this file) and press **Run**
- It should finish with "Success. No rows returned"

## 4. Point the app at your project

Supabase replaced the old anon/service_role keys with **publishable** and
**secret** keys. Use the publishable one.

- Go to **Settings -> API Keys**, tab **Publishable and secret API keys**
  (press **Create new API keys** if the project has none yet)
- Copy the key starting `sb_publishable_`
- The **Project URL** is on **Settings -> Data API**. Use the bare URL, with no
  `/rest/v1/` on the end
- In the project root (next to `package.json`), create a file called `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- Stop the dev server and start it again. Environment variables are read at
  startup, so a reload is not enough.

`.env` is listed in `.gitignore` and will not be committed.

## Using it

On the phone that owns the event: **event -> Share -> Start sharing**. A QR
code appears with a six-character code beneath it.

On the other phones: **Join** on the events list, then scan the QR (or type the
code). The event appears with all its people, prices and orders, and from then
on every phone sees the same running totals.

## What to know

**The publishable key is not a secret.** It ships inside the app, and it is
meant to. What protects your data is the row-level security in `schema.sql`: a
device can only read a session it has actually joined, and joining requires the
code. Never put a `sb_secret_` key (or the old `service_role` key) in the app --
those bypass every policy and would give anyone who extracted them full access
to the database.

**Orders can never overwrite each other.** Every tap is a separate row, so two
phones logging at the same moment both succeed. Entries can only be inserted,
never edited or deleted, so an order cannot silently disappear.

**Names, prices and paid status are last-edit-wins.** If two people rename the
same person at the same second, one edit wins. This is fine in practice, since
that setup happens before the event rather than during it.

**Offline is normal, not an error.** A phone that loses signal keeps logging;
the orders queue on the device and are sent when the connection returns. The
Share screen shows how many are waiting.

**Deleting an event only deletes it from that phone.** The shared copy stays in
Supabase. To remove it there, delete the row from the `sessions` table -- the
rest cascades.

## Cost

The free tier covers this use easily. Supabase pauses free projects after a
week with no activity; opening the app wakes it, which takes a few seconds.
If you plan to use it for a real event after a quiet period, open it once
beforehand rather than at the bar.
