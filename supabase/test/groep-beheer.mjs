/**
 * Proeft migratie 022 (groepsbeheerders, verwijderen door de groepsbeheerder)
 * op een echte Postgres.
 *
 *     node supabase/test/groep-beheer.mjs
 *
 * Draait schema.sql, 019 en 022 op PGlite (Postgres in WebAssembly, geen
 * Docker, geen netwerk), net als roster.mjs, en probeert als echte telefoons
 * wat wel en niet mag. Zie roster.mjs voor hoe Supabase hier is nagebouwd, en
 * voor de omgevingsvariabele PGLITE.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pgliteDir =
  process.env.PGLITE ??
  join('C:', 'Users', 'jaimy', 'Desktop', 'Claude', 'scoutingapp', 'node_modules', '@electric-sql', 'pglite');
const { PGlite } = await import(pathToFileURL(join(pgliteDir, 'dist', 'index.js')).href);

const db = new PGlite();
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${ok ? '' : extra ? '  -> ' + extra : ''}`);
};

const IPAD = '00000000-0000-0000-0000-0000000000a1'; // maakt de groep en de lijsten
const IPHONE = '00000000-0000-0000-0000-0000000000b2'; // doet mee, wordt groepsbeheerder
const ANDROID = '00000000-0000-0000-0000-0000000000c3'; // doet mee, blijft gewoon lid
const VREEMD = '00000000-0000-0000-0000-0000000000d4'; // niet in de groep

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;
`);

const run = (file) => db.exec(readFileSync(join(here, '..', file), 'utf8'));
await run('schema.sql');
await run('019-group-roster.sql');
await run('022-groep-beheer.sql');
await run('022-groep-beheer.sql');
await db.exec(`grant all on all tables in schema public to authenticated; grant execute on all functions in schema public to authenticated;`);

async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try {
    const res = await db.query(sql);
    return { rows: res.rows, error: null };
  } catch (error) {
    return { rows: [], error };
  } finally {
    await db.exec(`reset role; select set_config('test.uid', '', false);`);
  }
}

const exists = async (id) =>
  (await db.query(`select 1 from public.sessions where id = '${id}'`)).rows.length === 1;
const admins = async () =>
  (await db.query(`select user_id from public.group_admins where group_id = 'g' order by user_id`)).rows.map((r) => r.user_id);

console.log('migratie 022');
check('draait twee keer zonder fout', true);

// -- opzet: de iPad maakt de groep, de rest doet mee
await as(IPAD, `select public.create_group('g', 'Barploeg', 'K4P7QX')`);
await as(IPHONE, `select public.join_group('K4P7QX')`);
await as(ANDROID, `select public.join_group('K4P7QX')`);

// Drie lijsten van de iPad: twee in de groep, één los gedeeld.
for (const id of ['zomer', 'sint', 'los']) {
  await as(IPAD, `select public.create_session('${id}', '${id.toUpperCase().padEnd(6, 'X')}', '${id}', 'event')`);
}
await as(IPAD, `update public.sessions set group_id = 'g' where id in ('zomer', 'sint')`);
await as(IPAD, `insert into public.session_people (id, session_id, name) values ('p1', 'zomer', 'Jan')`);

// -- verwijderen
{
  const r = await as(IPHONE, `select public.delete_session('zomer')`);
  check('een gewoon groepslid kan een lijst van de groep niet verwijderen', r.error && (await exists('zomer')));
}
{
  const r = await as(IPHONE, `select public.add_group_admin('g', '${IPHONE}')`);
  check('een gewoon lid kan zichzelf geen groepsbeheerder maken', r.error && !(await admins()).includes(IPHONE));
}
{
  const r = await as(IPAD, `select public.add_group_admin('g', '${IPHONE}')`);
  check('de groepsbeheerder maakt de iPhone groepsbeheerder', !r.error && (await admins()).includes(IPHONE), r.error?.message);
}
{
  const r = await as(IPAD, `select public.add_group_admin('g', '${VREEMD}')`);
  check('een toestel buiten de groep kan geen groepsbeheerder worden', r.error && !(await admins()).includes(VREEMD));
}
{
  const r = await as(IPHONE, `select public.delete_session('zomer')`);
  const people = await db.query(`select 1 from public.session_people where session_id = 'zomer'`);
  check(
    'de iPhone (groepsbeheerder, geen beheerder van de lijst) verwijdert een iPad-lijst van de groep',
    !r.error && !(await exists('zomer')) && people.rows.length === 0,
    r.error?.message
  );
}
{
  const r = await as(IPHONE, `select public.delete_session('los')`);
  check('maar niet een lijst die niet in de groep zit', r.error && (await exists('los')));
}
{
  const r = await as(ANDROID, `select public.delete_session('sint')`);
  check('het Android-lid kan nog steeds niets verwijderen', r.error && (await exists('sint')));
}
{
  const r = await as(VREEMD, `select public.delete_session('sint')`);
  check('een vreemde ook niet', r.error && (await exists('sint')));
}
{
  const r = await as(IPAD, `select public.delete_session('los')`);
  check('de beheerder van de lijst zelf kan het nog, zoals altijd', !r.error && !(await exists('los')), r.error?.message);
}

// -- groepsbeheerder zijn is geen beheerder van een lijst
{
  await as(IPAD, `insert into public.session_people (id, session_id, name) values ('p2', 'sint', 'Piet')`);
  await as(IPHONE, `update public.session_people set paid_cents = 2000 where id = 'p2'`);
  const paid = await db.query(`select paid_cents from public.session_people where id = 'p2'`);
  check(
    'een groepsbeheerder kan geen betaling vastleggen in een lijst waar hij geen beheerder van is',
    Number(paid.rows[0]?.paid_cents ?? 0) === 0,
    JSON.stringify(paid.rows)
  );
  const admin = await as(IPHONE, `select public.is_admin('sint') as a`);
  check('is_admin blijft nee voor de groepsbeheerder', admin.rows[0]?.a === false);
}

// -- intrekken en minstens één houden
{
  const r = await as(ANDROID, `select public.remove_group_admin('g', '${IPAD}')`);
  check('een gewoon lid kan geen groepsbeheerder intrekken', r.error && (await admins()).includes(IPAD));
}
{
  const r = await as(IPHONE, `select public.remove_group_admin('g', '${IPAD}')`);
  check('een groepsbeheerder trekt een andere in', !r.error && !(await admins()).includes(IPAD), r.error?.message);
}
{
  const r = await as(IPHONE, `select public.remove_group_admin('g', '${IPHONE}')`);
  check('de laatste groepsbeheerder kan niet worden ingetrokken', r.error && (await admins()).includes(IPHONE));
}

// -- groep verlaten
{
  const r = await as(IPHONE, `select public.leave_group('g')`);
  check(
    'de laatste groepsbeheerder kan niet weg zolang er anderen in de groep zitten',
    r.error && String(r.error.message).includes('last admin of this group')
  );
}
{
  await as(IPHONE, `select public.add_group_admin('g', '${ANDROID}')`);
  const r = await as(IPHONE, `select public.leave_group('g')`);
  const member = await db.query(`select 1 from public.group_members where group_id = 'g' and user_id = '${IPHONE}'`);
  check(
    'met een tweede beheerder kan hij wel weg, en is hij daarna ook geen beheerder meer',
    !r.error && member.rows.length === 0 && !(await admins()).includes(IPHONE),
    r.error?.message
  );
}
{
  const r = await as(IPHONE, `insert into public.group_roster (id, group_id, name) values ('r1', 'g', 'Klaas')`);
  check('wie vertrok kan de ledenlijst niet meer wijzigen', Boolean(r.error));
}
{
  await as(IPAD, `select public.leave_group('g')`);
  const r = await as(ANDROID, `select public.leave_group('g')`);
  check('het laatste toestel mag de groep verlaten', !r.error && (await admins()).length === 0, r.error?.message);
}

console.log(`\n${passed} gelukt, ${failed} mislukt`);
process.exit(failed === 0 ? 0 : 1);
