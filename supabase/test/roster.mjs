/**
 * Proeft migratie 019 (de ledenlijst van de groep) op een echte Postgres.
 *
 *     node supabase/test/roster.mjs
 *
 * Draait schema.sql en dan 019 op PGlite (Postgres in WebAssembly, geen Docker,
 * geen netwerk) en gooit er echte gebruikers tegenaan. Row-level security faalt
 * stil: een verkeerd beleid geeft geen foutmelding, de rijen verschijnen of
 * verdwijnen gewoon. Daarom wordt hier elke regel uit de migratie beproefd.
 *
 * Wat Supabase zelf levert (rollen, auth.uid(), de realtime-publicatie) is hier
 * nagebouwd. De superuser omzeilt RLS, dus elke bewering draait na
 * `set role authenticated`: de rol waarmee de publishable key binnenkomt.
 *
 * PGlite zit niet in package.json. Wijs ernaar met PGLITE (de map van het
 * pakket); standaard wordt het project Fluitje gebruikt, waar het al staat.
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

const ADMIN = '00000000-0000-0000-0000-0000000000a1'; // maakt de groep
const LID = '00000000-0000-0000-0000-0000000000b2'; // telefoon in de groep, geen beheerder
const VREEMD = '00000000-0000-0000-0000-0000000000c3'; // niet in de groep

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

await db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'));
// Wat een bestaande groep al had voor 019: gemaakt met de oude create_group,
// zonder group_admins.
await db.exec(`insert into public.groups (id, name, join_code, created_by) values ('oud', 'Oude groep', 'OUD123', '${ADMIN}');
insert into public.group_members (group_id, user_id) values ('oud', '${ADMIN}'), ('oud', '${LID}');`);
await db.exec(readFileSync(join(here, '..', '019-group-roster.sql'), 'utf8'));
// Twee keer draaien mag.
await db.exec(readFileSync(join(here, '..', '019-group-roster.sql'), 'utf8'));
await db.exec(`grant all on all tables in schema public to authenticated; grant execute on all functions in schema public to authenticated;`);

/** Voer uit als een telefoon. Geeft de fout terug als er een is. */
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

console.log('migratie 019');
check('draait twee keer zonder fout', true);

// -- bestaande groep: de maker is beheerder
{
  const r = await as(ADMIN, `select public.is_group_admin('oud') as a`);
  check('maker van een bestaande groep is beheerder (backfill)', r.rows[0]?.a === true);
  const l = await as(LID, `select public.is_group_admin('oud') as a`);
  check('een lid van de groep is geen beheerder', l.rows[0]?.a === false);
}

// -- nieuwe groep via create_group
{
  const r = await as(ADMIN, `select public.create_group('nieuw', 'Nieuwe groep', 'NIEUW1')`);
  check('create_group werkt nog', r.error === null, r.error?.message);
  const a = await as(ADMIN, `select public.is_group_admin('nieuw') as a`);
  check('wie een nieuwe groep maakt is er meteen beheerder van', a.rows[0]?.a === true);
}

// -- schrijven: alleen een beheerder
{
  const s = await as(ADMIN, `insert into public.group_sections (id, group_id, name) values ('s1', 'oud', 'Loodsen')`);
  check('beheerder maakt een speltak', s.error === null, s.error?.message);
  const m = await as(ADMIN, `insert into public.group_roster (id, group_id, name, section_id) values ('m1', 'oud', 'Anne de Boer', 's1')`);
  check('beheerder voegt een lid toe', m.error === null, m.error?.message);

  const bad = await as(LID, `insert into public.group_roster (id, group_id, name) values ('m2', 'oud', 'Indringer')`);
  check('een lid-telefoon mag geen naam toevoegen (database weigert)', bad.error !== null);
  const badSec = await as(LID, `insert into public.group_sections (id, group_id, name) values ('s9', 'oud', 'Nep')`);
  check('een lid-telefoon mag geen speltak toevoegen', badSec.error !== null);

  const upd = await as(LID, `update public.group_roster set name = 'Gehackt' where id = 'm1' returning id`);
  check('een lid-telefoon kan geen naam hernoemen (0 rijen geraakt)', upd.rows.length === 0 && upd.error === null, JSON.stringify(upd));
  const del = await as(LID, `delete from public.group_roster where id = 'm1' returning id`);
  check('een lid-telefoon kan geen naam verwijderen', del.rows.length === 0);
  const adm = await as(LID, `insert into public.group_admins (group_id, user_id) values ('oud', '${LID}')`);
  check('een lid-telefoon kan zichzelf geen beheerder maken', adm.error !== null);
  const adm2 = await as(ADMIN, `insert into public.group_admins (group_id, user_id) values ('oud', '${LID}')`);
  check('ook een beheerder schrijft niet rechtstreeks in group_admins', adm2.error !== null);
}

// -- lezen: alleen wie in de groep zit
{
  const lid = await as(LID, `select name from public.group_roster where group_id = 'oud'`);
  check('een lid-telefoon leest de ledenlijst', lid.rows.length === 1 && lid.rows[0].name === 'Anne de Boer');
  const sec = await as(LID, `select name from public.group_sections where group_id = 'oud'`);
  check('een lid-telefoon leest de speltakken', sec.rows.length === 1);
  const vreemd = await as(VREEMD, `select name from public.group_roster`);
  check('een telefoon buiten de groep ziet niets', vreemd.rows.length === 0);
  const vreemdAdm = await as(VREEMD, `select * from public.group_admins`);
  check('een telefoon buiten de groep ziet de beheerders niet', vreemdAdm.rows.length === 0);
}

// -- dubbele namen
{
  const same = await as(ADMIN, `insert into public.group_roster (id, group_id, name) values ('m3', 'oud', 'anne  DE boer')`);
  check('dezelfde naam met andere hoofdletters en spaties kan niet twee keer', same.error !== null);
  await as(ADMIN, `update public.group_roster set removed_at = now() where id = 'm1'`);
  const again = await as(ADMIN, `insert into public.group_roster (id, group_id, name) values ('m4', 'oud', 'Anne de Boer')`);
  check('ook een weggehaalde naam kan niet opnieuw (terugzetten in plaats van nog een)', again.error !== null);
  await as(ADMIN, `update public.group_roster set removed_at = null where id = 'm1'`);
  const otherGroup = await as(ADMIN, `insert into public.group_roster (id, group_id, name) values ('m5', 'nieuw', 'Anne de Boer')`);
  check('dezelfde naam in een andere groep mag wel', otherGroup.error === null, otherGroup.error?.message);
}

// -- een speltak van een andere groep
{
  await as(ADMIN, `insert into public.group_sections (id, group_id, name) values ('s2', 'nieuw', 'Stam')`);
  await as(ADMIN, `insert into public.group_roster (id, group_id, name, section_id) values ('m6', 'oud', 'Bram Visser', 's2')`);
  const r = await as(ADMIN, `select section_id from public.group_roster where id = 'm6'`);
  check('een speltak van een andere groep wordt niet gekoppeld', r.rows[0]?.section_id === null, JSON.stringify(r.rows));
  const del = await as(ADMIN, `delete from public.group_sections where id = 's1' returning id`);
  const left = await as(ADMIN, `select name, section_id from public.group_roster where id = 'm1'`);
  check('een speltak weghalen laat de naam staan, zonder speltak', del.rows.length === 1 && left.rows[0]?.section_id === null);
}

// -- verhuizen tussen groepen kan niet
{
  const mv = await as(ADMIN, `update public.group_roster set group_id = 'nieuw' where id = 'm6' returning group_id`);
  check('een naam verhuist niet naar een andere groep', mv.rows[0]?.group_id !== 'nieuw', JSON.stringify(mv.rows));
}

// -- de koppeling op een lijst
{
  const col = await db.query(`select column_name from information_schema.columns where table_name = 'session_people' and column_name = 'roster_id'`);
  check('session_people heeft roster_id', col.rows.length === 1);
}

console.log(`\n${passed} gelukt, ${failed} mislukt`);
process.exit(failed === 0 ? 0 : 1);
