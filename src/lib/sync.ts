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

import { isAdminDevice } from './pin';
import { isSettled } from './totals';

import type {
  AppEvent,
  Category,
  LedgerCategory,
  ListKind,
  MenuItem,
  OrderEntry,
  Person,
  RosterMember,
  RosterSection,
  SessionMember,
} from './types';
import { ensureSignedIn, supabase } from './supabase';

type PersonRow = {
  id: string;
  session_id: string;
  name: string;
  /** Vrije toevoeging, bijvoorbeeld de scoutinggroep van een gast. */
  note: string | null;
  /** Kept in step for older clients; paid_cents is what counts. */
  paid: boolean;
  paid_cents: number;
  paid_at: string | null;
  removed_at: string | null;
  removed_by: string | null;
  member_id: string | null;
  /** Rows from before billing existed have the database default, 'tonight'. */
  billing: 'invoice' | 'tonight';
  guest_of: string | null;
  /** Pas na supabase/019-group-roster.sql, en alleen gevuld bij een naam uit de ledenlijst. */
  roster_id?: string | null;
};
type ItemRow = {
  id: string;
  session_id: string;
  name: string;
  price_cents: number;
  category: string;
  hidden: boolean;
  /** Null for items from before the treasurer's columns existed. */
  ledger: LedgerCategory | null;
};
type EntryRow = {
  id: string;
  session_id: string;
  person_id: string;
  item_id: string;
  delta: number;
  device_id: string;
  device_name: string | null;
  /** Null from app versions older than the price being recorded. */
  price_cents: number | null;
  /** Alleen bij een rondje, en pas na supabase/018-rondjes.sql. */
  for_person_id?: string | null;
  round_id?: string | null;
  created_at: string;
};

// ------------------------------------------------------------- mapping ----

const toPerson = (row: PersonRow): Person => ({
  id: row.id,
  name: row.name,
  note: row.note ?? undefined,
  paidCents: row.paid_cents ?? 0,
  paidAt: row.paid_at ? Date.parse(row.paid_at) : null,
  removedAt: row.removed_at ? Date.parse(row.removed_at) : null,
  removedBy: row.removed_by ?? null,
  memberId: row.member_id ?? null,
  billing: row.billing === 'invoice' ? 'invoice' : 'tonight',
  guestOf: row.guest_of ?? null,
  rosterId: row.roster_id ?? null,
});

const fromPerson = (sessionId: string, person: Person, settled: boolean): PersonRow => ({
  id: person.id,
  session_id: sessionId,
  name: person.name,
  note: person.note ?? null,
  paid: settled,
  paid_cents: person.paidCents,
  paid_at: person.paidAt ? new Date(person.paidAt).toISOString() : null,
  removed_at: person.removedAt ? new Date(person.removedAt).toISOString() : null,
  removed_by: person.removedBy,
  member_id: person.memberId,
  billing: person.billing,
  guest_of: person.guestOf,
  // Alleen meesturen als er iets te melden is. Zo blijft een lijst synchroniseren
  // op een database waar 019 nog niet gedraaid is, zolang niemand de ledenlijst gebruikt.
  ...(person.rosterId ? { roster_id: person.rosterId } : {}),
});

const toItem = (row: ItemRow): MenuItem => ({
  id: row.id,
  name: row.name,
  priceCents: row.price_cents,
  category: row.category as Category,
  hidden: row.hidden ?? false,
  ledger: row.ledger ?? undefined,
});

const fromItem = (sessionId: string, item: MenuItem): ItemRow => ({
  id: item.id,
  session_id: sessionId,
  name: item.name,
  price_cents: item.priceCents,
  category: item.category,
  hidden: item.hidden ?? false,
  ledger: item.ledger ?? null,
});

const toEntry = (row: EntryRow): OrderEntry => ({
  id: row.id,
  personId: row.person_id,
  itemId: row.item_id,
  delta: row.delta,
  deviceId: row.device_id,
  deviceName: row.device_name,
  priceCents: row.price_cents ?? null,
  forPersonId: row.for_person_id ?? null,
  roundId: row.round_id ?? null,
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
  price_cents: entry.priceCents,
  // Alleen bij een rondje. Een gewone turf stuurt de kolommen niet mee, zodat
  // hij ook werkt zolang de server ze nog niet heeft.
  ...(entry.roundId
    ? { for_person_id: entry.forPersonId ?? null, round_id: entry.roundId }
    : {}),
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
 * that works. Also returns the turfs the server refused (see pushEntries), for
 * the caller to drop.
 */
export async function hostSession(
  event: AppEvent,
  joinCode: string
): Promise<{ joinCode: string; refusedEntryIds: string[] }> {
  await ensureSignedIn();
  const db = client();

  const { error } = await db.rpc('create_session', {
    p_id: event.id,
    p_join_code: joinCode,
    p_name: event.name,
    p_kind: event.kind,
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
      const refusedEntryIds = await pushEntries(event.id, event.entries);
      return { joinCode: data.join_code as string, refusedEntryIds };
    }

    throw error;
  }

  await pushDetails(event);
  const refusedEntryIds = await pushEntries(event.id, event.entries);
  return { joinCode, refusedEntryIds };
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

/**
 * The shared copy is gone, because the host deleted it.
 *
 * This gets its own type rather than being one more failure, because "deleted"
 * and "no signal" deserve opposite responses on a guest phone: one is worth
 * retrying forever, the other never is.
 */
export class SessionGoneError extends Error {
  constructor() {
    super('De gedeelde lijst is verwijderd door de telefoon die hem deelde.');
    this.name = 'SessionGoneError';
  }
}

/**
 * Delete the shared copy of an event, for everybody.
 *
 * Only the host may do this and the database checks that rather than trusting
 * the caller. Every phone keeps its own local copy, so this clears the server
 * without anyone losing what they turfed.
 */
export async function deleteSharedSession(sessionId: string): Promise<void> {
  await ensureSignedIn();
  const db = client();
  const { error } = await db.rpc('delete_session', { p_session_id: sessionId });
  if (error) throw error;
}

export type RemoteSession = {
  name: string;
  kind: ListKind;
  createdAt: number;
  closed: boolean;
  /** De groep waar de lijst bij hoort, of null als hij los wordt gedeeld. */
  groupId: string | null;
  people: Person[];
  menu: MenuItem[];
  entries: OrderEntry[];
};

// -------------------------------------------------------------- ideeën ----

/** Een idee zoals het in de app getoond wordt. */
export type Idea = {
  id: string;
  body: string;
  deviceName: string | null;
  appVersion: string | null;
  platform: string | null;
  createdAt: number;
  /** Of deze telefoon de inzender is; alleen die mag hem terugtrekken. */
  mine: boolean;
};

/**
 * Een idee insturen.
 *
 * Hoort bij de groep, zodat de hele ploeg ziet wat er al bedacht is. Versie en
 * platform gaan mee: bij "dat knopje doet het niet" scheelt dat zoeken.
 */
export async function submitIdea(idea: {
  id: string;
  body: string;
  groupId: string | null;
  deviceName: string | null;
  appVersion: string | null;
  platform: string;
}): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().from('ideas').insert({
    id: idea.id,
    group_id: idea.groupId,
    body: idea.body,
    device_name: idea.deviceName,
    app_version: idea.appVersion,
    platform: idea.platform,
  });
  if (error) throw error;
}

/** De ideeën van de groep, nieuwste eerst. Zonder groep: alleen je eigen. */
export async function fetchIdeas(groupId: string | null): Promise<Idea[]> {
  const me = await ensureSignedIn();
  const db = client();

  let query = db
    .from('ideas')
    .select('id, body, device_name, app_version, platform, created_at, created_by')
    .order('created_at', { ascending: false })
    .limit(200);
  // Zonder groep laat de policy alleen je eigen inzendingen zien; met groep
  // filteren we erop, zodat een oude inzending van een andere ploeg niet
  // tussen de lijst van vanavond komt te staan.
  if (groupId) query = query.eq('group_id', groupId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    body: row.body as string,
    deviceName: (row.device_name as string | null) ?? null,
    appVersion: (row.app_version as string | null) ?? null,
    platform: (row.platform as string | null) ?? null,
    createdAt: Date.parse(row.created_at as string),
    mine: row.created_by === me,
  }));
}

/** Je eigen inzending terugtrekken. De database laat alleen die van jou toe. */
export async function deleteIdea(id: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().from('ideas').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------- groepen ----

/**
 * Een groep is de barploeg.
 *
 * Telefoons scannen één keer de groepscode en zien daarna elke lijst van de
 * groep, zonder dat iemand per lijst nog een code hoeft te delen. Lid zijn van
 * de groep geeft lezen en turven; corrigeren en betalen blijft per lijst aan
 * de beheertelefoons. De database bewaakt dat, niet deze code.
 */
export type RemoteGroup = { id: string; name: string; joinCode: string };

/** Een lijst van de groep, zoals hij op het groepsoverzicht staat. */
export type GroupSession = {
  id: string;
  name: string;
  kind: ListKind;
  joinCode: string;
  createdAt: number;
  closed: boolean;
};

/** Een toestel in de groep, zoals het Groep-scherm het laat zien. */
export type GroupMember = {
  userId: string;
  /** Wat dat toestel zichzelf noemt. Leeg tot het de nieuwe versie heeft geopend. */
  name: string | null;
  joinedAt: number;
  /** Groepsbeheerder: beheert de ledenlijst en mag lijsten van de groep verwijderen. */
  admin: boolean;
};

export async function createGroup(id: string, name: string, joinCode: string): Promise<RemoteGroup> {
  await ensureSignedIn();
  const { error } = await client().rpc('create_group', {
    p_id: id,
    p_name: name,
    p_join_code: joinCode,
  });
  if (error) throw error;
  return { id, name, joinCode: joinCode.toUpperCase() };
}

/** Deelnemen met de groepscode. De enige manier om in een groep te komen. */
export async function joinGroup(joinCode: string): Promise<RemoteGroup> {
  await ensureSignedIn();
  const db = client();

  const { data, error } = await db.rpc('join_group', { p_join_code: joinCode.trim() });
  if (error) throw error;
  if (!data) throw new Error('Geen groep met die code.');

  const group = await fetchGroup(data as string);
  if (!group) throw new Error('De groep is niet te lezen na het deelnemen.');
  return group;
}

export async function fetchGroup(groupId: string): Promise<RemoteGroup | null> {
  const { data, error } = await client()
    .from('groups')
    .select('id, name, join_code')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, name: data.name as string, joinCode: data.join_code as string };
}

export async function leaveGroup(groupId: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().rpc('leave_group', { p_group_id: groupId });
  if (error) throw error;
}

/** Alle lijsten van de groep, nieuwste eerst. */
export async function fetchGroupSessions(groupId: string): Promise<GroupSession[]> {
  const { data, error } = await client()
    .from('sessions')
    .select('id, name, kind, join_code, created_at, closed')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    kind: (row.kind === 'tab' ? 'tab' : 'event') as ListKind,
    joinCode: row.join_code as string,
    createdAt: Date.parse(row.created_at as string),
    closed: Boolean(row.closed),
  }));
}

/**
 * Eén lijst zoals de server hem kent, voor het scherm van een lijst die nog
 * niet op dit toestel staat. Null als hij er niet (meer) is, of als dit toestel
 * hem niet mag zien.
 */
export async function fetchGroupSession(sessionId: string): Promise<GroupSession | null> {
  const { data, error } = await client()
    .from('sessions')
    .select('id, name, kind, join_code, created_at, closed')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    kind: (data.kind === 'tab' ? 'tab' : 'event') as ListKind,
    joinCode: data.join_code as string,
    createdAt: Date.parse(data.created_at as string),
    closed: Boolean(data.closed),
  };
}

/** Wie er in de groep zit, oudste eerst, met wie groepsbeheerder is. */
export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const db = client();
  const [members, admins] = await Promise.all([
    db.from('group_members').select('user_id, name, joined_at').eq('group_id', groupId).order('joined_at'),
    db.from('group_admins').select('user_id').eq('group_id', groupId),
  ]);
  const failure = members.error ?? admins.error;
  if (failure) throw failure;
  const adminIds = new Set((admins.data ?? []).map((row) => row.user_id as string));
  return (members.data ?? []).map((row) => ({
    userId: row.user_id as string,
    name: (row.name as string | null) || null,
    joinedAt: Date.parse(row.joined_at as string),
    admin: adminIds.has(row.user_id as string),
  }));
}

/**
 * Dit toestel een naam geven in de groep, zodat de anderen zien wie er meedoet.
 *
 * Een toestel mag alleen zijn eigen rij wijzigen; dat bewaakt de database
 * (beleid group_members_name_own, uit 014).
 */
export async function setGroupMemberName(groupId: string, name: string): Promise<void> {
  const userId = await ensureSignedIn();
  const { error } = await client()
    .from('group_members')
    .update({ name: name.trim() })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Een toestel in de groep groepsbeheerder maken. De database kijkt wie het vraagt (022). */
export async function addGroupAdmin(groupId: string, userId: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().rpc('add_group_admin', { p_group_id: groupId, p_user_id: userId });
  if (error) throw error;
}

/** Een groepsbeheerder intrekken. Een groep houdt er altijd minstens één (022). */
export async function removeGroupAdmin(groupId: string, userId: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().rpc('remove_group_admin', { p_group_id: groupId, p_user_id: userId });
  if (error) throw error;
}

/** Het eigen id van dit toestel op de server, om "dit toestel" aan te wijzen. */
export const myUserId = (): Promise<string> => ensureSignedIn();

/**
 * Een bestaande gedeelde lijst bij de groep zetten.
 *
 * Mag alleen een beheerder van die lijst, alleen als hij nog bij geen groep
 * hoort, en alleen bij een groep waar die beheerder zelf in zit. De trigger in
 * de database bewaakt alle drie; lukt het niet, dan blijft group_id gewoon
 * leeg en zegt deze functie dat.
 */
export async function attachToGroup(sessionId: string, groupId: string): Promise<void> {
  await ensureSignedIn();
  const db = client();

  const { error } = await db.from('sessions').update({ group_id: groupId }).eq('id', sessionId);
  if (error) throw error;

  const { data, error: readError } = await db
    .from('sessions')
    .select('group_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (readError) throw readError;
  if (data?.group_id !== groupId) {
    throw new Error(
      'De lijst is niet aan de groep gekoppeld. Dit kan alleen op een beheertelefoon, en alleen zolang de lijst nog bij geen groep hoort.'
    );
  }
}

/** Zoveel rijen vragen we per keer; gelijk aan wat Supabase standaard toestaat. */
const PAGE_SIZE = 1000;

/**
 * Alle rijen van één lijst uit een tabel, in stukken.
 *
 * De server geeft per vraag hoogstens "Max rows" rijen terug (standaard 1000,
 * in te stellen in Supabase) en zegt er niet bij dat er meer was. Een seizoen op
 * de lopende rekening komt daar overheen, en dan miste de telefoon die de lijst
 * ophaalde stil de rest: een nieuwe iPad na verlies van de oude kreeg niet alle
 * turven terug, en een telefoon die lang offline was haalde niet alles in.
 *
 * Daarom in stukken, gesorteerd op id, en elk volgend stuk na de laatste id van
 * het vorige. Dat blijft kloppen als er tussendoor turven bijkomen; een turf die
 * dan net achter ons belandt, komt bij de volgende keer ophalen of via realtime
 * binnen. Het eerste stuk vraagt ook hoeveel er in totaal zijn, zodat een gewone
 * lijst met één vraag klaar is, ook als "Max rows" kleiner staat dan PAGE_SIZE.
 */
async function fetchAllRows<Row extends { id: string }>(
  table: 'session_people' | 'session_items' | 'order_entries',
  sessionId: string
): Promise<Row[]> {
  const db = client();
  const rows: Row[] = [];
  let after: string | null = null;
  let total: number | null = null;

  for (let first = true; ; first = false) {
    let query = db
      .from(table)
      .select('*', first ? { count: 'exact' } : undefined)
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (after !== null) query = query.gt('id', after);

    const { data, error, count } = await query;
    if (error) throw error;
    if (first) total = count ?? null;

    const page = (data ?? []) as Row[];
    if (page.length === 0) break;
    rows.push(...page);
    if (total !== null && rows.length >= total) break;

    const last = page[page.length - 1].id;
    // Geen voortgang zou eindeloos blijven vragen. Mag niet voorkomen, maar
    // een telefoon aan de bar die vastloopt in een lus is erger dan een gat.
    if (last === after) break;
    after = last;
  }
  return rows;
}

/** Read the whole shared event. Used when joining, and to catch up after being offline. */
export async function fetchSession(sessionId: string): Promise<RemoteSession> {
  const db = client();

  const [session, people, items, entries] = await Promise.all([
    db
      .from('sessions')
      .select('name, kind, closed, created_at, group_id')
      .eq('id', sessionId)
      .maybeSingle(),
    fetchAllRows<PersonRow>('session_people', sessionId),
    fetchAllRows<ItemRow>('session_items', sessionId),
    fetchAllRows<EntryRow>('order_entries', sessionId),
  ]);

  if (session.error) throw session.error;
  // maybeSingle rather than single: a missing row is a deleted session, which
  // is an answer, not a database error.
  if (!session.data) throw new SessionGoneError();

  return {
    name: session.data.name,
    kind: session.data.kind === 'tab' ? 'tab' : 'event',
    createdAt: Date.parse(session.data.created_at),
    closed: session.data.closed,
    groupId: session.data.group_id ?? null,
    people: people.map(toPerson),
    menu: items.map(toItem),
    entries: entries.map(toEntry).sort((a, b) => a.createdAt - b.createdAt),
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
 * Take this phone out of a shared list.
 *
 * Stopping sharing used to be a local decision only, which left this phone
 * among the participants on every other phone. A phone may remove itself and
 * nothing else; the database checks that. Refused for the last admin of a list
 * that still has other phones in it, because that would leave a list nobody can
 * correct.
 */
export async function leaveSession(sessionId: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().rpc('leave_session', { p_session_id: sessionId });
  if (error) throw error;
}

/** Which phones are admins of a list, as user ids. */
export async function fetchAdmins(sessionId: string): Promise<string[]> {
  const db = client();
  const { data, error } = await db
    .from('session_admins')
    .select('user_id')
    .eq('session_id', sessionId);
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

/**
 * Make a phone that has joined into an admin. Only an admin may, and the
 * database checks that itself, so a visible button is not what grants it.
 */
export async function addAdmin(sessionId: string, userId: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().rpc('add_admin', {
    p_session_id: sessionId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/** Stop a phone being an admin. Refused for the last admin of a list. */
export async function removeAdmin(sessionId: string, userId: string): Promise<void> {
  await ensureSignedIn();
  const { error } = await client().rpc('remove_admin', {
    p_session_id: sessionId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/**
 * Send order rows, and return the ids of any the server refused.
 *
 * `ignoreDuplicates` makes this safe to call repeatedly: a row already on the
 * server is skipped rather than treated as an error, so retrying after a
 * dropped connection can never double-count an order.
 *
 * The server quietly drops a turf removal from a phone that is not an admin,
 * such as one that lost admin while a removal was still queued, instead of
 * failing the whole batch. Rows are never deleted, so a removal that is not on
 * the server once this returns was refused. The caller should drop it from
 * this phone as well, or its totals would differ from every other phone's.
 */
export async function pushEntries(sessionId: string, entries: OrderEntry[]): Promise<string[]> {
  if (entries.length === 0) return [];
  const db = client();

  const { error } = await db
    .from('order_entries')
    .upsert(entries.map((entry) => fromEntry(sessionId, entry)), {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  if (error) throw error;

  // Only removals can be refused, so only those are checked. In batches, since
  // the ids travel in the URL and re-sharing sends every turf at once.
  const removals = entries.filter((entry) => entry.delta <= 0).map((entry) => entry.id);
  const refused: string[] = [];
  for (let start = 0; start < removals.length; start += 100) {
    const batch = removals.slice(start, start + 100);
    const { data, error: readError } = await db
      .from('order_entries')
      .select('id')
      .eq('session_id', sessionId)
      .in('id', batch);
    if (readError) throw readError;
    const stored = new Set((data ?? []).map((row: { id: string }) => row.id));
    refused.push(...batch.filter((id) => !stored.has(id)));
  }
  return refused;
}

/** Send the parts that are edited rather than appended. */
export async function pushDetails(event: AppEvent): Promise<void> {
  const db = client();
  // Only an admin's menu is accepted; the server quietly ignores anyone else's.
  // Not sending it at all saves the round trip, and keeps a member's stale copy
  // from ever looking like an attempt to change prices.
  const sendMenu = isAdminDevice(event);

  const results = await Promise.all([
    db.from('sessions').update({ name: event.name, closed: event.closed }).eq('id', event.id),
    event.people.length
      ? db
          .from('session_people')
          .upsert(event.people.map((p) => fromPerson(event.id, p, isSettled(event, p))))
      : Promise.resolve({ error: null }),
    sendMenu && event.menu.length
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
      // Becoming or ceasing to be an admin is a change to the phone list too.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_admins', filter },
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

// ------------------------------------------------- ledenlijst van de groep ----
//
// Eén lijst namen voor de hele groep (supabase/019-group-roster.sql). Elke
// telefoon in de groep leest hem; alleen een beheerder van de groep schrijft. De
// database dwingt dat af: de functies hieronder zeggen dus gewoon wat er
// terugkomt en vertrouwen niet op wat de knop van de app liet zien.

export type Roster = {
  members: RosterMember[];
  sections: RosterSection[];
  /** Of deze telefoon beheerder van de groep is. */
  admin: boolean;
};

export async function fetchRoster(groupId: string): Promise<Roster> {
  const db = client();
  const me = await ensureSignedIn();
  const [members, sections, admins] = await Promise.all([
    db.from('group_roster').select('id, name, section_id, removed_at').eq('group_id', groupId),
    db.from('group_sections').select('id, name').eq('group_id', groupId),
    db.from('group_admins').select('user_id').eq('group_id', groupId),
  ]);
  const failure = members.error ?? sections.error ?? admins.error;
  if (failure) throw failure;
  return {
    members: (members.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      sectionId: (row.section_id as string | null) ?? null,
      removedAt: row.removed_at ? Date.parse(row.removed_at as string) : null,
    })),
    sections: (sections.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string })),
    admin: (admins.data ?? []).some((row) => row.user_id === me),
  };
}

/** Namen erbij. Een naam die er al staat (ook weggehaald) weigert de database. */
export async function addRosterMembers(
  groupId: string,
  members: { id: string; name: string; sectionId: string | null }[]
): Promise<void> {
  if (members.length === 0) return;
  const { error } = await client()
    .from('group_roster')
    .insert(
      members.map((member) => ({
        id: member.id,
        group_id: groupId,
        name: member.name,
        section_id: member.sectionId,
      }))
    );
  if (error) throw error;
}

/** Eén wijziging aan een naam of speltak. Raakt het niets, dan was dit geen beheerder. */
async function changeRoster(
  table: 'group_roster' | 'group_sections',
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { data, error } = await client().from(table).update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Alleen een beheerder van de groep kan de ledenlijst wijzigen.');
  }
}

export const renameRosterMember = (id: string, name: string) => changeRoster('group_roster', id, { name });
export const setRosterMemberSection = (id: string, sectionId: string | null) =>
  changeRoster('group_roster', id, { section_id: sectionId });
export const setRosterMemberRemoved = (id: string, removed: boolean) =>
  changeRoster('group_roster', id, { removed_at: removed ? new Date().toISOString() : null });

export async function addRosterSection(groupId: string, id: string, name: string): Promise<void> {
  const { error } = await client().from('group_sections').insert({ id, group_id: groupId, name });
  if (error) throw error;
}

export const renameRosterSection = (id: string, name: string) => changeRoster('group_sections', id, { name });

export async function removeRosterSection(id: string): Promise<void> {
  const { data, error } = await client().from('group_sections').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Alleen een beheerder van de groep kan de ledenlijst wijzigen.');
  }
}

/**
 * Meekijken naar wijzigingen in de ledenlijst, zodat een naam die een beheerder
 * toevoegt meteen op de andere telefoons staat. Geeft de functie terug om te
 * stoppen.
 */
export function subscribeToRoster(groupId: string, onChange: () => void): () => void {
  const db = client();
  const filter = `group_id=eq.${groupId}`;
  const channel = db
    .channel(`turf-roster:${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_roster', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_sections', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_admins', filter }, onChange)
    .subscribe();
  return () => {
    client().removeChannel(channel);
  };
}
