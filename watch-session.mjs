// Observe a shared session from outside the app, to check what actually
// reached the server. Usage: node watch-session.mjs <JOINCODE>
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const code = (process.argv[2] || '').trim().toUpperCase();
if (!code) { console.error('usage: node watch-session.mjs <JOINCODE>'); process.exit(1); }

const vars = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) vars[m[1]] = m[2];
}
const db = createClient(
  vars.EXPO_PUBLIC_SUPABASE_URL,
  vars.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? vars.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { error: authErr } = await db.auth.signInAnonymously();
if (authErr) { console.error('sign-in failed:', authErr.message); process.exit(1); }

const { data: sessionId, error: joinErr } = await db.rpc('join_session', { p_join_code: code });
if (joinErr) { console.error('join failed:', joinErr.message); process.exit(1); }

const cents = (n) => '€' + (n / 100).toFixed(2).replace('.', ',');

async function snapshot() {
  const [s, people, items, entries] = await Promise.all([
    db.from('sessions').select('name, closed').eq('id', sessionId).single(),
    db.from('session_people').select('*').eq('session_id', sessionId),
    db.from('session_items').select('*').eq('session_id', sessionId),
    db.from('order_entries').select('*').eq('session_id', sessionId).order('created_at'),
  ]);

  const price = Object.fromEntries((items.data ?? []).map((i) => [i.id, i]));
  const rows = entries.data ?? [];
  const devices = new Set(rows.map((r) => r.device_id));

  console.clear();
  console.log(`SESSION "${s.data?.name}"   code ${code}`);
  console.log(`order rows: ${rows.length}   devices that have logged: ${devices.size}`);
  console.log('-'.repeat(58));

  let grand = 0;
  for (const person of people.data ?? []) {
    const mine = rows.filter((r) => r.person_id === person.id);
    const total = mine.reduce((sum, r) => sum + r.delta * (price[r.item_id]?.price_cents ?? 0), 0);
    grand += total;
    const byItem = {};
    for (const r of mine) {
      const n = price[r.item_id]?.name ?? '?';
      byItem[n] = (byItem[n] ?? 0) + r.delta;
    }
    const detail = Object.entries(byItem).filter(([, q]) => q > 0).map(([n, q]) => `${q}x ${n}`).join(', ');
    console.log(`${person.name.padEnd(14)} ${cents(total).padStart(9)}  ${person.paid ? '[BETAALD]' : '         '} ${detail}`);
  }
  console.log('-'.repeat(58));
  console.log('TOTAL'.padEnd(14) + cents(grand).padStart(9));
  console.log('\nlast 5 rows (newest last):');
  for (const r of rows.slice(-5)) {
    console.log(`  ${new Date(r.created_at).toLocaleTimeString()}  ${(price[r.item_id]?.name ?? '?').padEnd(14)} ${r.delta > 0 ? '+' : ''}${r.delta}  from device ${r.device_id.slice(0, 8)}`);
  }
  console.log('\nwatching… (Ctrl+C to stop)');
}

await snapshot();
db.channel('watch:' + sessionId)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'order_entries', filter: `session_id=eq.${sessionId}` }, snapshot)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'session_people', filter: `session_id=eq.${sessionId}` }, snapshot)
  .subscribe();

setInterval(snapshot, 5000); // fallback in case a realtime event is missed
