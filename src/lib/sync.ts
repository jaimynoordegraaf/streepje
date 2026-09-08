/**
 * Talking to the shared copy of an event.
 *
 * The local store always stays authoritative for what you can see and do. This
 * module pushes what this device has logged, pulls what other devices logged,
 * and merges the two. Because order entries are only ever appended, merging is
 * just "add the rows I do not have yet" -- there is no conflict to resolve.
 *
 * People, the menu and the event name are different: those get edited rather
 * than appended, so the last edit wins. That is fine in practice, because they
 * are set up once before the event rather than changed by several people at
 * the same moment.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import type { AppEvent, Category, MenuItem, OrderEntry, Person, SessionMember } from './types';
import { ensureSignedIn, supabase } from './supabase';

type PersonRow = {
  id: string;
  session_id: string;
  name: string;
  paid: boolean;
  paid_at: string | null;
};
type ItemRow = {
  id: string;
  session_id: string;
  name: string;
  price_cents: number;
  category: string;
};
type EntryRow = {
  id: string;
  session_id: string;
  person_id: string;
  item_id: string;
  delta: number;
  device_id: string;
  device_name: string | null;
  created_at: string;
};

// ------------------------------------------------------------- mapping ----

const toPerson = (row: PersonRow): Person => ({
  id: row.id,
  name: row.name,
  paid: row.paid,
  paidAt: row.paid_at ? Date.parse(row.paid_at) : null,
});

const fromPerson = (sessionId: string, person: Person): PersonRow => ({
  id: person.id,
  session_id: sessionId,
  name: person.name,
  paid: person.paid,
  paid_at: person.paidAt ? new Date(person.paidAt).toISOString() : null,
});

const toItem = (row: ItemRow): MenuItem => ({
  id: row.id,
  name: row.name,
  priceCents: row.price_cents,
  category: row.category as Category,
});

const fromItem = (sessionId: string, item: MenuItem): ItemRow => ({
  id: item.id,
  session_id: sessionId,
  name: item.name,
  price_cents: item.priceCents,
  category: item.category,
});

const toEntry = (row: EntryRow): OrderEntry => ({
  id: row.id,
  personId: row.person_id,
  itemId: row.item_id,
  delta: row.delta,
  deviceId: row.device_id,
  deviceName: row.device_name,
  createdAt: Date.parse(row.created_at),
});

const fromEntry = (sessionId: string, entry: OrderEntry): EntryRow => ({
  id: entry.id,
  session_id: sessionId,
  person_id: entry.personId,
  item_id: entry.itemId,
  delta: entry.delta,
  device_id: entry.deviceId,
  device_name: entry.deviceName,
  created_at: new Date(entry.createdAt).toISOString(),
});

type MemberRow = {
  session_id: string;
  user_id: string;
  name: string | null;
  joined_at: string;
};

const toMember = (row: MemberRow): SessionMember => ({
  userId: row.user_id,
  name: row.name,
  joinedAt: Date.parse(row.joined_at),
});

function client() {
  if (!supabase) throw new Error('Delen is niet ingesteld in deze versie.');
  return supabase;
}

// ------------------------------------------------------------ operations ---

/**
 * Publish a local event so other devices can join it.
 *
 * Returns the join code actually in use, which is not always the one asked
 * for: an event can already be online, and then its existing code is the one
 * that works.
 */
export async function hostSession(event: AppEvent, joinCode: string): Promise<string> {
  await ensureSignedIn();
  const db = client();

  const { error } = await db.rpc('create_session', {
    p_id: event.id,
    p_join_code: joinCode,
    p_name: event.name,
  });

  if (error) {
    const duplicate = (error as { code?: string }).code === '23505';
    const message = typeof error.message === 'string' ? error.message : '';

    if (duplicate && message.includes('sessions_pkey')) {
      // The event is already published. This happens when an earlier attempt
      // created the row and then failed further on, and when sharing was
      // stopped on this phone, which deliberately leaves the shared copy in
      // place. Carrying on with the existing copy is right in both cases;
      // failing would strand the event permanently, since every retry would
      // hit the same collision.
      const { data, error: readError } = await db
        .from('sessions')
        .select('join_code')
        .eq('id', event.id)
        .maybeSingle();

      if (readError) throw readError;
      if (!data) {
        throw new Error(
          'Dit evenement staat al online, maar deze telefoon heeft er geen toegang meer toe. Maak een nieuw evenement aan en turf daarin verder.'
        );
      }

      await pushDetails(event);
      await pushEntries(event.id, event.entries);
      return data.join_code as string;
    }

    throw error;
  }

  await pushDetails(event);
  await pushEntries(event.id, event.entries);
  return joinCode;
}

/** Join someone else's session using the code from their QR. */
export async function joinSession(joinCode: string): Promise<string> {
  await ensureSignedIn();
  const db = client();

  const { data, error } = await db.rpc('join_session', { p_join_code: joinCode.trim() });
  if (error) throw error;
  if (!data) throw new Error('Geen sessie met die code.');
  return data as string;
}

export type RemoteSession = {
  name: string;
  createdAt: number;
  closed: boolean;
  people: Person[];
  menu: MenuItem[];
  entries: OrderEntry[];
};

/** Read the whole shared event. Used when joining, and to catch up after being offline. */
export async function fetchSession(sessionId: string): Promise<RemoteSession> {
  const db = client();

  const [session, people, items, entries] = await Promise.all([
    db.from('sessions').select('name, closed, created_at').eq('id', sessionId).single(),
    db.from('session_people').select('*').eq('session_id', sessionId),
    db.from('session_items').select('*').eq('session_id', sessionId),
    db.from('order_entries').select('*').eq('session_id', sessionId),
  ]);

  const failure = session.error ?? people.error ?? items.error ?? entries.error;
  if (failure) throw failure;
  if (!session.data) throw new Error('Die sessie bestaat niet meer.');

  return {
    name: session.data.name,
    createdAt: Date.parse(session.data.created_at),
    closed: session.data.closed,
    people: (people.data ?? []).map(toPerson),
    menu: (items.data ?? []).map(toItem),
    entries: (entries.data ?? []).map(toEntry).sort((a, b) => a.createdAt - b.createdAt),
  };
}

/** Who is taking part, oldest first. */
export async function fetchMembers(sessionId: string): Promise<SessionMember[]> {
  const db = client();
  const { data, error } = await db
    .from('session_members')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at');
  if (error) throw error;
  return (data ?? []).map(toMember);
}

/**
 * Name this phone within a session.
 *
 * A device may only rename itself; the database enforces that, so there is no
 * need to trust the client's filter here.
 */
export async function setMemberName(sessionId: string, name: string): Promise<void> {
  const userId = await ensureSignedIn();
  const db = client();
  const { error } = await db
    .from('session_members')
    .update({ name: name.trim() })
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Send order rows.
 *
 * `ignoreDuplicates` makes this safe to call repeatedly: a row already on the
 * server is skipped rather than treated as an error, so retrying after a
 * dropped connection can never double-count an order.
 */
export async function pushEntries(sessionId: string, entries: OrderEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = client();

  const { error } = await db
    .from('order_entries')
    .upsert(entries.map((entry) => fromEntry(sessionId, entry)), {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

/** Send the parts that are edited rather than appended. */
export async function pushDetails(event: AppEvent): Promise<void> {
  const db = client();

  const results = await Promise.all([
    db.from('sessions').update({ name: event.name, closed: event.closed }).eq('id', event.id),
    event.people.length
      ? db.from('session_people').upsert(event.people.map((p) => fromPerson(event.id, p)))
      : Promise.resolve({ error: null }),
    event.menu.length
      ? db.from('session_items').upsert(event.menu.map((i) => fromItem(event.id, i)))
      : Promise.resolve({ error: null }),
  ]);

  const failure = results.find((result) => result.error)?.error;
  if (failure) throw failure;
}

type Handlers = {
  onEntry?: (entry: OrderEntry) => void;
  onDetailsChanged?: () => void;
  /** Fires when a phone joins or renames itself. */
  onMembersChanged?: () => void;
};

/**
 * One realtime connection per session, shared by every screen that wants it.
 *
 * Screens stack up -- opening Share leaves the event screen mounted underneath
 * -- and each would otherwise open its own socket to the same channel. This
 * keeps a single connection and hands updates to all the listeners, closing it
 * only once the last one goes away.
 */
const openChannels = new Map<string, { channel: RealtimeChannel; listeners: Set<Handlers> }>();

export function subscribeToSession(sessionId: string, handlers: Handlers): () => void {
  let record = openChannels.get(sessionId);

  if (!record) {
    const db = client();
    const listeners = new Set<Handlers>();
    const filter = `session_id=eq.${sessionId}`;
    const announce = () => listeners.forEach((listener) => listener.onDetailsChanged?.());
    const announceMembers = () => listeners.forEach((listener) => listener.onMembersChanged?.());

    const channel = db
      .channel(`turf:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_entries', filter },
        (payload) => {
          const entry = toEntry(payload.new as EntryRow);
          listeners.forEach((listener) => listener.onEntry?.(entry));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_people', filter },
        announce
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_items', filter },
        announce
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        announce
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_members', filter },
        announceMembers
      )
      .subscribe();

    record = { channel, listeners };
    openChannels.set(sessionId, record);
  }

  record.listeners.add(handlers);

  return () => {
    const current = openChannels.get(sessionId);
    if (!current) return;
    current.listeners.delete(handlers);
    if (current.listeners.size === 0) {
      client().removeChannel(current.channel);
      openChannels.delete(sessionId);
    }
  };
}
