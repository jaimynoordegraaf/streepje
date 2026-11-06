/**
 * The single source of truth for the whole app.
 *
 * `zustand` holds the state; the `persist` wrapper saves it to the phone after
 * every change and loads it again on the next launch. Sharing an event across
 * devices (see lib/sync.ts) adds a server copy, but this local one always stays
 * authoritative for what you can see and do offline.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { guessLedger } from './ledger';
import type {
  AppEvent,
  Billing,
  ListKind,
  MenuItem,
  OrderEntry,
  Person,
  PinRecord,
  SavedPerson,
  Section,
  ShareInfo,
} from './types';

/** Unique id: the current time in base36 plus 10 random characters. */
export function newId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/** A short, human-typable code for joining a session, e.g. "K4P7QX". */
export function newJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1: too easy to misread
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

/**
 * A person as they join a list. How they pay follows from the list unless said
 * otherwise: everyone on a tab is invoiced, and at an event someone added by
 * name is a guest who settles on the night.
 */
function newPerson(
  event: AppEvent,
  name: string,
  options: {
    memberId?: string | null;
    billing?: Billing;
    guestOf?: string | null;
    note?: string;
  } = {}
): Person {
  const note = options.note?.trim();
  return {
    id: newId(),
    name,
    note: note ? note : undefined,
    paidCents: 0,
    paidAt: null,
    removedAt: null,
    removedBy: null,
    memberId: options.memberId ?? null,
    billing: options.billing ?? (event.kind === 'tab' ? 'invoice' : 'tonight'),
    guestOf: options.guestOf ?? null,
  };
}

/** What a brand new install starts with. Edit it freely in Settings. */
const STARTER_MENU: Omit<MenuItem, 'id'>[] = [
  { name: 'Bier', priceCents: 250, category: 'drink' },
  { name: 'Wijn', priceCents: 300, category: 'drink' },
  { name: 'Frisdrank', priceCents: 200, category: 'drink' },
  { name: 'Koffie / thee', priceCents: 150, category: 'drink' },
  { name: 'Water', priceCents: 0, category: 'drink' },
  { name: 'Hamburger', priceCents: 550, category: 'food' },
  { name: 'Friet', priceCents: 300, category: 'food' },
  { name: 'Snack', priceCents: 200, category: 'food' },
];

function withIds(items: Omit<MenuItem, 'id'>[]): MenuItem[] {
  return items.map((item) => ({ ...item, id: newId() }));
}

/**
 * Eén regel voor het log, zoals hij op dit moment is.
 *
 * Staat los van `addOrder` omdat een turf ook al vóór het vastleggen een regel
 * moet zijn (zie pending.ts): de prijs, de tijd en de telefoon horen bij de tik
 * en niet bij het moment waarop de bedenktijd om is.
 */
export function buildEntry(
  event: AppEvent,
  deviceId: string,
  deviceName: string | null,
  personId: string,
  itemId: string,
  delta: number
): OrderEntry {
  const item = event.menu.find((candidate) => candidate.id === itemId);
  return {
    id: newId(),
    personId,
    itemId,
    delta,
    deviceId,
    deviceName,
    // Frozen at the tap. Changing the menu later must not reach back
    // into turfs that were already made.
    priceCents: item ? item.priceCents : null,
    createdAt: Date.now(),
  };
}

/** Replace one event in the list, leaving the others untouched. */
function mapEvent(
  events: AppEvent[],
  eventId: string,
  change: (event: AppEvent) => AppEvent
): AppEvent[] {
  return events.map((event) => (event.id === eventId ? change(event) : event));
}

/** Drop order entries pointing at a person or item that no longer exists. */
function pruneEntries(entries: OrderEntry[], personIds: string[], itemIds: string[]): OrderEntry[] {
  const people = new Set(personIds);
  const items = new Set(itemIds);
  return entries.filter((entry) => people.has(entry.personId) && items.has(entry.itemId));
}

type StoreState = {
  /** Identifies this phone in the order log. Generated once, then kept. */
  deviceId: string;
  /**
   * What this phone last called itself when joining a shared event, used to
   * prefill the prompt next time. Absent on installs from before naming
   * existed, which the persist merge handles by falling back to null.
   */
  deviceName: string | null;
  /**
   * De groep waar deze telefoon bij hoort: de barploeg.
   *
   * Eén keer scannen is genoeg; daarna verschijnen de lijsten van de groep
   * vanzelf. Hier staat alleen wat deze telefoon nodig heeft om ze op te
   * halen -- wie er lid is en wat je mag, weet de database.
   */
  group: { id: string; name: string; joinCode: string } | null;
  /**
   * Of de rondleiding al een keer voorbij is gekomen.
   *
   * Hij hoort bij de telefoon en niet bij een lijst, dus hij staat hier en niet
   * in een eigen sleutel: zo reist hij mee met de rest van wat bewaard wordt en
   * is er maar één plek die hem kan vergeten.
   */
  tourSeen: boolean;
  /**
   * De lopende rekening die als laatste is geopend, en dus waar de app mee
   * opent. Zie `useHomeList` onderaan. Null zolang er nog geen is geopend; dan
   * geldt de nieuwste rekening op deze telefoon.
   */
  homeTabId: string | null;
  /**
   * Streepjes in plaats van bedragen bij de namen, zoals op de papieren lijst.
   *
   * Hoort bij het apparaat en niet bij een lijst: het gaat erom wie er naar
   * dít scherm kijkt. Dus het reist nooit mee met het delen van een lijst.
   * Totalen en de exports laten hun bedragen altijd zien.
   */
  tallyMode: boolean;
  events: AppEvent[];
  /** The menu that newly created events start from. */
  defaultMenu: MenuItem[];
  /**
   * Names kept between events. The same people turn up most weeks, and typing
   * them in again each time is the slowest part of setting an event up.
   */
  defaultPeople: SavedPerson[];
  /**
   * De speltakken waarin de vaste namen zijn opgedeeld: loodsen, stam,
   * bestuur, wat de groep ook heeft. Zelf te benoemen, want geen twee
   * scoutinggroepen zijn hetzelfde opgeknipt. Zie `Section` in types.ts voor
   * waarom het geen "groep" heet.
   */
  sections: Section[];

  createEvent: (name: string, kind?: ListKind) => string;
  /**
   * De voorbeeldlijst voor de rondleiding: een avond met drie namen en een
   * paar turfjes erop, zodat de echte schermen iets te laten zien hebben.
   * Geeft de ids terug die de rondleiding nodig heeft om ernaartoe te varen.
   */
  createDemoEvent: () => { eventId: string; personId: string };
  /** Haalt elke voorbeeldlijst weg. Veilig als er geen is. */
  removeDemoEvents: () => void;
  renameEvent: (eventId: string, name: string) => void;
  deleteEvent: (eventId: string) => void;
  setEventClosed: (eventId: string, closed: boolean) => void;
  /** Onthoud welke lopende rekening de volgende keer als eerste opengaat. */
  setHomeTab: (eventId: string) => void;
  setTallyMode: (on: boolean) => void;

  /** Add someone by name. At an event that is a guest settling tonight, unless said otherwise. */
  addPerson: (
    eventId: string,
    name: string,
    options?: { billing?: Billing; guestOf?: string | null; note?: string }
  ) => void;
  /**
   * Copy members from the season tab into an event, each linked to their row
   * in the tab by id. Anyone already in the event is skipped.
   */
  addMembers: (eventId: string, members: { id: string; name: string }[]) => void;
  /** How someone pays. Admin-only on a shared list. */
  setPersonBilling: (eventId: string, personId: string, billing: Billing) => void;
  /** Who a guest came with. */
  setGuestOf: (eventId: string, personId: string, guestOf: string | null) => void;
  /** Vrije toevoeging achter de naam, bijvoorbeeld een scoutinggroep. */
  setPersonNote: (eventId: string, personId: string, note: string) => void;
  /** Add several names at once, skipping any already in the event. */
  addPeople: (eventId: string, names: string[]) => void;
  /**
   * A placeholder for a sale to someone not on the list, so serving is not
   * held up by working out who they are. Returns the new person's id.
   */
  addUnknownPerson: (eventId: string) => string;
  renamePerson: (eventId: string, personId: string, name: string) => void;
  /**
   * Take someone off the event without destroying what they had.
   *
   * Guarded in the interface by the correction PIN and the host phone, for the
   * same reason removing a single turf is: this used to delete their entries
   * outright, which erased money and left nothing behind to notice.
   */
  removePerson: (eventId: string, personId: string, removedBy: string | null) => void;
  restorePerson: (eventId: string, personId: string) => void;
  /** Record the total handed over so far. Pass 0 to undo a payment. */
  setPersonPayment: (eventId: string, personId: string, paidCents: number) => void;

  addItem: (eventId: string, draft: Omit<MenuItem, 'id'>) => void;
  updateItem: (eventId: string, itemId: string, patch: Partial<Omit<MenuItem, 'id'>>) => void;
  /** Takes an item off the menu; past turfs for it still count. */
  removeItem: (eventId: string, itemId: string) => void;
  restoreItem: (eventId: string, itemId: string) => void;

  /** Log an order (delta 1) or a correction (delta -1). Always appends. */
  addOrder: (eventId: string, personId: string, itemId: string, delta: number) => void;
  /**
   * Zet regels die al zijn opgebouwd in het log, in één keer. Alleen voor
   * strepen die hun bedenktijd achter de rug hebben (pending.ts): wat hier
   * binnenkomt staat vast en kan alleen nog met de correctiecode weg.
   */
  commitEntries: (eventId: string, entries: OrderEntry[]) => void;

  addDefaultPerson: (name: string, sectionId?: string | null) => void;
  renameDefaultPerson: (personId: string, name: string) => void;
  removeDefaultPerson: (personId: string) => void;
  /** Zet de speltak van een vaste naam, of haal hem er met null weer af. */
  setDefaultPersonSection: (personId: string, sectionId: string | null) => void;

  /** Nieuwe speltak. Een naam die al bestaat levert er geen tweede op. */
  addSection: (name: string) => void;
  renameSection: (sectionId: string, name: string) => void;
  /**
   * Haalt een speltak weg. De namen die erbij hoorden blijven staan en horen
   * daarna bij geen speltak meer -- een speltak opheffen mag nooit mensen uit
   * de vaste lijst meenemen.
   */
  removeSection: (sectionId: string) => void;

  addDefaultItem: (draft: Omit<MenuItem, 'id'>) => void;
  updateDefaultItem: (itemId: string, patch: Partial<Omit<MenuItem, 'id'>>) => void;
  removeDefaultItem: (itemId: string) => void;

  /** Onthoud dat de rondleiding is langsgekomen, of zet hem weer open. */
  setTourSeen: (seen: boolean) => void;

  // --- used by the sync engine -------------------------------------------

  setDeviceName: (name: string) => void;
  /** De groep van deze telefoon, of null na het verlaten ervan. */
  setGroup: (group: { id: string; name: string; joinCode: string } | null) => void;
  /** Onthoud dat een lijst bij een groep hoort. De server beslist dat. */
  setEventGroup: (eventId: string, groupId: string | null) => void;
  setShare: (eventId: string, share: ShareInfo | null) => void;
  /** Remember what the server last said about this phone being an admin. */
  setShareRole: (eventId: string, role: ShareInfo['role']) => void;
  /** Set or replace the PIN that guards removing a turf. */
  setCorrectionPin: (eventId: string, pin: PinRecord | null) => void;
  /** Take an event that exists on the server and put it on this device. */
  adoptRemoteEvent: (event: AppEvent) => void;
  /** Fold in rows the server has that this device does not. */
  mergeRemoteEntries: (eventId: string, entries: OrderEntry[]) => void;
  /** Replace the parts that are edited rather than appended. */
  mergeRemoteDetails: (
    eventId: string,
    details: {
      name: string;
      closed: boolean;
      people: Person[];
      menu: MenuItem[];
      /** Alleen gelezen: koppelen aan een groep gebeurt op de server. */
      groupId?: string | null;
    }
  ) => void;
  markEntriesSynced: (eventId: string, entryIds: string[]) => void;
  /**
   * Forget turfs the server refused: removals made on a phone that was no longer
   * an admin. They never reached the shared list, so keeping them here would
   * leave this phone's totals different from everyone else's.
   */
  dropEntries: (eventId: string, entryIds: string[]) => void;
  noteSynced: (eventId: string) => void;
};

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      deviceId: newId(),
      deviceName: null,
      group: null,
      tourSeen: false,
      homeTabId: null,
      tallyMode: false,
      events: [],
      defaultMenu: withIds(STARTER_MENU),
      defaultPeople: [],
      sections: [],

      createEvent: (name, kind = 'event') => {
        const id = newId();
        const event: AppEvent = {
          id,
          name: name.trim() || (kind === 'tab' ? 'Lopende rekening' : 'Naamloos evenement'),
          kind,
          createdAt: Date.now(),
          people: [],
          // Copy the default menu and give each item a fresh id, so editing this
          // event's menu never reaches back and changes the template.
          menu: get().defaultMenu.map((item) => ({ ...item, id: newId() })),
          entries: [],
          unsyncedEntryIds: [],
          closed: false,
          groupId: null,
          share: null,
          correctionPin: null,
        };
        set({ events: [event, ...get().events] });
        return id;
      },

      createDemoEvent: () => {
        const menu = get().defaultMenu.map((item) => ({ ...item, id: newId() }));
        const people = ['Sanne', 'Joost', 'Imke'].map((name) => ({
          id: newId(),
          name,
          paidCents: 0,
          paidAt: null,
          removedAt: null,
          removedBy: null,
          memberId: null,
          // Op een lopende rekening gaat alles op de factuur.
          billing: 'invoice' as Billing,
          guestOf: null,
        }));

        // Een paar turfjes, want een rondleiding langs een lijst waar overal
        // nul staat laat juist niet zien wat de app doet. Op het eerste
        // drankje van het menu, en in de tijd uit elkaar getrokken zodat het
        // logboek er ook als een avond uitziet.
        const drink = menu.find((item) => item.category === 'drink') ?? menu[0];
        const entries: OrderEntry[] = [];
        const now = Date.now();
        people.forEach((person, index) => {
          for (let turf = 0; turf < [3, 1, 2][index]; turf++) {
            entries.push({
              id: newId(),
              personId: person.id,
              itemId: drink.id,
              delta: 1,
              deviceId: get().deviceId,
              // Een verse telefoon heeft nog geen naam, en dan zou het logboek
              // "telefoon onbekend" tonen bij juist de stap die uitlegt dat je
              // ziet van welke telefoon een turf kwam. De hele lijst is
              // verzonnen, dus deze naam mag dat ook zijn.
              deviceName: get().deviceName ?? 'Bar',
              priceCents: drink.priceCents,
              createdAt: now - (index * 3 + turf) * 7 * 60 * 1000,
            });
          }
        });

        const event: AppEvent = {
          id: newId(),
          name: 'Voorbeeldrekening',
          // Een lopende rekening, want zo opent de app echt op de iPad.
          kind: 'tab',
          createdAt: now,
          people,
          menu,
          entries,
          unsyncedEntryIds: [],
          closed: false,
          groupId: null,
          share: null,
          correctionPin: null,
          demo: true,
        };
        // Een eventuele vorige voorbeeldlijst gaat eraf, zodat er nooit
        // twee kunnen staan.
        set({ events: [event, ...get().events.filter((other) => !other.demo)] });
        return { eventId: event.id, personId: people[0].id };
      },

      removeDemoEvents: () => {
        const left = get().events.filter((event) => !event.demo);
        // Niets schrijven als er niets te halen valt, anders zou het
        // beginscherm zichzelf bij elke render opnieuw aan het werk zetten.
        if (left.length !== get().events.length) set({ events: left });
      },

      renameEvent: (eventId, name) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            name: name.trim() || event.name,
          })),
        }),

      deleteEvent: (eventId) =>
        set({ events: get().events.filter((event) => event.id !== eventId) }),

      setHomeTab: (eventId) => {
        // Niets schrijven als hij al zo staat: het wordt bij elk bezoek aan
        // de lijst aangeroepen, en elke schrijfbeurt gaat de opslag in.
        if (get().homeTabId !== eventId) set({ homeTabId: eventId });
      },

      setEventClosed: (eventId, closed) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            // The season tab runs for good; the server ignores closing one too.
            closed: event.kind === 'tab' ? false : closed,
          })),
        }),

      // Adding people and turfs does nothing on a closed event. The screens hide
      // those buttons already; this catches any way round them.
      addPerson: (eventId, name, options) =>
        set({
          events: mapEvent(get().events, eventId, (event) =>
            event.closed
              ? event
              : {
                  ...event,
                  people: [...event.people, newPerson(event, name.trim() || 'Iemand', options)],
                }
          ),
        }),

      addPeople: (eventId, names) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            if (event.closed) return event;
            const taken = new Set(event.people.map((person) => person.name.toLowerCase()));
            const fresh = names
              .map((name) => name.trim())
              .filter((name) => name !== '' && !taken.has(name.toLowerCase()))
              .map((name) => newPerson(event, name));
            return { ...event, people: [...event.people, ...fresh] };
          }),
        }),

      addMembers: (eventId, members) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            if (event.closed) return event;
            // A member already in this event -- even one since removed -- is
            // not added a second time. Two rows for one member would split
            // their turfs across two lines of the invoice.
            const present = new Set(
              event.people.map((person) => person.memberId).filter((memberId) => memberId !== null)
            );
            const fresh = members
              .filter((member) => !present.has(member.id))
              .map((member) =>
                newPerson(event, member.name, { memberId: member.id, billing: 'invoice' })
              );
            return { ...event, people: [...event.people, ...fresh] };
          }),
        }),

      addUnknownPerson: (eventId) => {
        const id = newId();
        set({
          events: mapEvent(get().events, eventId, (event) => {
            if (event.closed) return event;
            // Numbered so several unknowns in one evening stay apart until
            // someone remembers who they were. The digits are matched with
            // [0-9], not a backslash escape: this pattern once lost its
            // backslash, matched nothing, and named every unknown "Onbekend 1".
            const highest = event.people.reduce((max, person) => {
              const match = /^Onbekend( [0-9]+)?$/.exec(person.name);
              if (!match) return max;
              return Math.max(max, match[1] ? Number(match[1]) : 1);
            }, 0);
            return {
              ...event,
              people: [...event.people, { ...newPerson(event, `Onbekend ${highest + 1}`), id }],
            };
          }),
        });
        return id;
      },

      setPersonBilling: (eventId, personId, billing) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            people: event.people.map((person) =>
              person.id === personId ? { ...person, billing } : person
            ),
          })),
        }),

      setPersonNote: (eventId, personId, note) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            people: event.people.map((person) =>
              person.id === personId
                ? { ...person, note: note.trim() === '' ? undefined : note.trim() }
                : person
            ),
          })),
        }),

      setGuestOf: (eventId, personId, guestOf) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            people: event.people.map((person) =>
              person.id === personId ? { ...person, guestOf } : person
            ),
          })),
        }),

      renamePerson: (eventId, personId, name) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            people: event.people.map((person) =>
              person.id === personId ? { ...person, name: name.trim() || person.name } : person
            ),
          })),
        }),

      removePerson: (eventId, personId, removedBy) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            // Their entries deliberately stay. The log is the record.
            people: event.people.map((person) =>
              person.id === personId
                ? { ...person, removedAt: Date.now(), removedBy }
                : person
            ),
          })),
        }),

      restorePerson: (eventId, personId) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            people: event.people.map((person) =>
              person.id === personId
                ? { ...person, removedAt: null, removedBy: null }
                : person
            ),
          })),
        }),

      setPersonPayment: (eventId, personId, paidCents) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            people: event.people.map((person) =>
              person.id === personId
                ? {
                    ...person,
                    paidCents: Math.max(0, Math.round(paidCents)),
                    paidAt: paidCents > 0 ? Date.now() : null,
                  }
                : person
            ),
          })),
        }),

      addItem: (eventId, draft) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            menu: [...event.menu, { ...draft, id: newId() }],
          })),
        }),

      updateItem: (eventId, itemId, patch) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            menu: event.menu.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
          })),
        }),

      removeItem: (eventId, itemId) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            // Kept rather than deleted: turfs already logged against it still
            // need its price, and dropping them would erase money silently.
            menu: event.menu.map((item) =>
              item.id === itemId ? { ...item, hidden: true } : item
            ),
          })),
        }),

      restoreItem: (eventId, itemId) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            menu: event.menu.map((item) =>
              item.id === itemId ? { ...item, hidden: false } : item
            ),
          })),
        }),

      addOrder: (eventId, personId, itemId, delta) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            if (event.closed) return event;
            const entry = buildEntry(
              event,
              get().deviceId,
              get().deviceName,
              personId,
              itemId,
              delta
            );
            return {
              ...event,
              entries: [...event.entries, entry],
              unsyncedEntryIds: [...event.unsyncedEntryIds, entry.id],
            };
          }),
        }),

      commitEntries: (eventId, entries) => {
        if (entries.length === 0) return;
        set({
          events: mapEvent(get().events, eventId, (event) => {
            if (event.closed) return event;
            // Een regel die er al staat nog eens toevoegen zou een turf dubbel
            // tellen en dubbel versturen.
            const known = new Set(event.entries.map((entry) => entry.id));
            const fresh = entries.filter((entry) => !known.has(entry.id));
            if (fresh.length === 0) return event;
            return {
              ...event,
              entries: [...event.entries, ...fresh],
              unsyncedEntryIds: [...event.unsyncedEntryIds, ...fresh.map((entry) => entry.id)],
            };
          }),
        });
      },

      addDefaultPerson: (name, sectionId = null) =>
        set({
          defaultPeople: [
            ...get().defaultPeople,
            { id: newId(), name: name.trim() || 'Iemand', sectionId },
          ],
        }),

      renameDefaultPerson: (personId, name) =>
        set({
          defaultPeople: get().defaultPeople.map((person) =>
            person.id === personId ? { ...person, name: name.trim() || person.name } : person
          ),
        }),

      removeDefaultPerson: (personId) =>
        set({ defaultPeople: get().defaultPeople.filter((person) => person.id !== personId) }),

      setDefaultPersonSection: (personId, sectionId) =>
        set({
          defaultPeople: get().defaultPeople.map((person) =>
            person.id === personId ? { ...person, sectionId } : person
          ),
        }),

      addSection: (name) => {
        const trimmed = name.trim();
        if (trimmed === '') return;
        // Twee speltakken met dezelfde naam geven twee chips die niet van
        // elkaar te onderscheiden zijn, en dan is niet te zien welke de helft
        // van de namen heeft.
        const exists = get().sections.some(
          (section) => section.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (exists) return;
        set({ sections: [...get().sections, { id: newId(), name: trimmed }] });
      },

      renameSection: (sectionId, name) =>
        set({
          sections: get().sections.map((section) =>
            section.id === sectionId ? { ...section, name: name.trim() || section.name } : section
          ),
        }),

      removeSection: (sectionId) =>
        set({
          sections: get().sections.filter((section) => section.id !== sectionId),
          defaultPeople: get().defaultPeople.map((person) =>
            person.sectionId === sectionId ? { ...person, sectionId: null } : person
          ),
        }),

      addDefaultItem: (draft) =>
        set({ defaultMenu: [...get().defaultMenu, { ...draft, id: newId() }] }),

      updateDefaultItem: (itemId, patch) =>
        set({
          defaultMenu: get().defaultMenu.map((item) =>
            item.id === itemId ? { ...item, ...patch } : item
          ),
        }),

      removeDefaultItem: (itemId) =>
        set({ defaultMenu: get().defaultMenu.filter((item) => item.id !== itemId) }),

      setTourSeen: (seen) => set({ tourSeen: seen }),

      setTallyMode: (tallyMode) => set({ tallyMode }),

      setDeviceName: (deviceName) => set({ deviceName: deviceName.trim() || null }),

      setGroup: (group) => set({ group }),

      setEventGroup: (eventId, groupId) =>
        set({ events: mapEvent(get().events, eventId, (event) => ({ ...event, groupId })) }),

      setShare: (eventId, share) =>
        set({ events: mapEvent(get().events, eventId, (event) => ({ ...event, share })) }),

      setShareRole: (eventId, role) => {
        const event = get().events.find((candidate) => candidate.id === eventId);
        // Runs on every sync and is almost always unchanged; skip the write then.
        if (!event?.share || event.share.role === role) return;
        set({
          events: mapEvent(get().events, eventId, (current) =>
            current.share ? { ...current, share: { ...current.share, role } } : current
          ),
        });
      },

      setCorrectionPin: (eventId, correctionPin) =>
        set({ events: mapEvent(get().events, eventId, (event) => ({ ...event, correctionPin })) }),

      adoptRemoteEvent: (event) =>
        set({
          events: get().events.some((existing) => existing.id === event.id)
            ? mapEvent(get().events, event.id, () => event)
            : [event, ...get().events],
        }),

      mergeRemoteEntries: (eventId, incoming) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            // The server charges each turf at its own menu price, so a turf
            // this phone already has can come back priced differently: sent
            // while offline across a price change, or at a price the menu does
            // not have. The server's price is the one that counts, and every
            // phone should show it.
            const serverPrice = new Map<string, number>();
            for (const entry of incoming) {
              if (entry.priceCents !== null) serverPrice.set(entry.id, entry.priceCents);
            }
            let repriced = false;
            const entries = event.entries.map((entry) => {
              const price = serverPrice.get(entry.id);
              if (price === undefined || price === entry.priceCents) return entry;
              repriced = true;
              return { ...entry, priceCents: price };
            });

            const known = new Set(entries.map((entry) => entry.id));
            const fresh = incoming.filter((entry) => !known.has(entry.id));
            if (fresh.length === 0 && !repriced) return event;
            return {
              ...event,
              entries: [...entries, ...fresh].sort((a, b) => a.createdAt - b.createdAt),
            };
          }),
        }),

      mergeRemoteDetails: (eventId, details) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            name: details.name,
            closed: details.closed,
            groupId: details.groupId ?? event.groupId ?? null,
            people: details.people,
            menu: details.menu,
          })),
        }),

      markEntriesSynced: (eventId, entryIds) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            const done = new Set(entryIds);
            return {
              ...event,
              unsyncedEntryIds: event.unsyncedEntryIds.filter((id) => !done.has(id)),
            };
          }),
        }),

      dropEntries: (eventId, entryIds) => {
        // Almost every push has nothing refused; skip the write then.
        if (entryIds.length === 0) return;
        const refused = new Set(entryIds);
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            entries: event.entries.filter((entry) => !refused.has(entry.id)),
            unsyncedEntryIds: event.unsyncedEntryIds.filter((id) => !refused.has(id)),
          })),
        });
      },

      noteSynced: (eventId) =>
        set({
          events: mapEvent(get().events, eventId, (event) =>
            event.share ? { ...event, share: { ...event.share, lastSyncedAt: Date.now() } } : event
          ),
        }),
    }),
    {
      name: 'turf-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * De voorbeeldlijst van de rondleiding gaat niet mee de opslag in.
       *
       * Hem er helemaal buiten houden is sterker dan hem achteraf opruimen:
       * wordt de app halverwege de rondleiding weggedrukt, dan is hij bij de
       * volgende start gewoon weg, zonder dat daar iets voor hoeft te draaien
       * dat zelf ook kan falen. De rest van de staat gaat zoals altijd mee.
       */
      partialize: (state) => ({
        ...state,
        events: state.events.filter((event) => !event.demo),
      }),
      version: 15,
      /**
       * Version 1 stored a running count per person per item. Version 2 stores
       * the order log instead. Each old count becomes a single entry carrying
       * that count as its delta, so every total comes out identical.
       */
      migrate: (persisted, fromVersion) => {
        const state = persisted as any;
        if (fromVersion < 2) {
          state.deviceId = state.deviceId ?? newId();
          state.events = (state.events ?? []).map((event: any) => {
            const entries: OrderEntry[] = [];
            const tally = event.tally ?? {};
            for (const personId of Object.keys(tally)) {
              for (const itemId of Object.keys(tally[personId] ?? {})) {
                const count = tally[personId][itemId];
                if (count > 0) {
                  entries.push({
                    id: newId(),
                    personId,
                    itemId,
                    delta: count,
                    deviceId: state.deviceId,
                    deviceName: null,
                    // Filled from the menu by the version 8 step below.
                    priceCents: null,
                    createdAt: event.createdAt ?? Date.now(),
                  });
                }
              }
            }
            const { tally: _dropped, ...rest } = event;
            return { ...rest, entries, unsyncedEntryIds: [], share: null };
          });
        }
        if (fromVersion < 3) {
          // The app shipped in English first. Rename only the exact names from
          // the original starter menu, so anything the user typed themselves is
          // left alone.
          const dutch: Record<string, string> = {
            Beer: 'Bier',
            Wine: 'Wijn',
            'Soft drink': 'Frisdrank',
            'Coffee / tea': 'Koffie / thee',
            Burger: 'Hamburger',
            Fries: 'Friet',
          };
          const rename = (items: MenuItem[] = []) =>
            items.map((item) => (dutch[item.name] ? { ...item, name: dutch[item.name] } : item));

          state.defaultMenu = rename(state.defaultMenu);
          state.events = (state.events ?? []).map((event: AppEvent) => ({
            ...event,
            menu: rename(event.menu),
          }));
        }

        if (fromVersion < 4) {
          // Events created before the correction PIN existed simply have none;
          // the host is asked to choose one the first time they correct.
          state.events = (state.events ?? []).map((event: AppEvent) => ({
            ...event,
            correctionPin: event.correctionPin ?? null,
          }));
        }

        if (fromVersion < 5) {
          // Entries written before phones had names simply have none.
          state.events = (state.events ?? []).map((event: AppEvent) => ({
            ...event,
            entries: (event.entries ?? []).map((entry: OrderEntry) => ({
              ...entry,
              deviceName: entry.deviceName ?? null,
            })),
          }));
        }

        if (fromVersion < 6) {
          // "paid" was a flag; it becomes the amount that was owed at the time,
          // which is what that flag actually meant.
          state.events = (state.events ?? []).map((event: any) => {
            const price = new Map<string, number>(
              (event.menu ?? []).map((item: MenuItem) => [item.id, item.priceCents])
            );
            const owed = (personId: string) =>
              (event.entries ?? [])
                .filter((entry: OrderEntry) => entry.personId === personId)
                .reduce(
                  (sum: number, entry: OrderEntry) =>
                    sum + entry.delta * (price.get(entry.itemId) ?? 0),
                  0
                );

            return {
              ...event,
              people: (event.people ?? []).map((person: any) => {
                const { paid, ...rest } = person;
                return {
                  ...rest,
                  paidCents: person.paidCents ?? (paid ? Math.max(0, owed(person.id)) : 0),
                };
              }),
            };
          });
        }

        if (fromVersion < 7) {
          state.events = (state.events ?? []).map((event: AppEvent) => ({
            ...event,
            people: (event.people ?? []).map((person: Person) => ({
              ...person,
              removedAt: person.removedAt ?? null,
              removedBy: person.removedBy ?? null,
            })),
          }));
        }

        if (fromVersion < 8) {
          // Turfs start carrying their own price. Existing ones take the menu
          // price as it stands, which is the price they were already counted
          // at, so no total moves -- they simply stop following the menu. The
          // database backfills its copy the same way.
          state.events = (state.events ?? []).map((event: AppEvent) => {
            const price = new Map(
              (event.menu ?? []).map((item: MenuItem) => [item.id, item.priceCents])
            );
            return {
              ...event,
              entries: (event.entries ?? []).map((entry: OrderEntry) => ({
                ...entry,
                priceCents: entry.priceCents ?? price.get(entry.itemId) ?? null,
              })),
            };
          });
        }

        if (fromVersion < 9) {
          // "Host" and "guest" became "admin" and "member" once a list could
          // have more than one phone allowed to correct it. The host of an
          // existing list is its first admin on the server too, and the next
          // sync confirms or corrects this either way.
          state.events = (state.events ?? []).map((event: any) =>
            event.share
              ? {
                  ...event,
                  share: {
                    ...event.share,
                    role:
                      event.share.role === 'host' || event.share.role === 'admin'
                        ? 'admin'
                        : 'member',
                  },
                }
              : event
          );
        }

        if (fromVersion < 10) {
          // Lists gain a kind and people learn how they pay. Everything that
          // already existed was an evening where people settled up at the end,
          // so that is what it stays.
          state.events = (state.events ?? []).map((event: any) => ({
            ...event,
            kind: event.kind ?? 'event',
            people: (event.people ?? []).map((person: any) => ({
              ...person,
              memberId: person.memberId ?? null,
              billing: person.billing ?? 'tonight',
              guestOf: person.guestOf ?? null,
            })),
          }));
        }

        if (fromVersion < 11) {
          // Menu-items krijgen een kolom van de penningmeester. Voor wat er al
          // stond is de naam de enige aanwijzing; de beheerder ziet de gok bij
          // elk item staan en zet hem recht waar nodig.
          const label = (items: MenuItem[] = []) =>
            items.map((item) => ({ ...item, ledger: item.ledger ?? guessLedger(item.name) }));

          state.defaultMenu = label(state.defaultMenu);
          state.events = (state.events ?? []).map((event: AppEvent) => ({
            ...event,
            menu: label(event.menu),
          }));
        }

        if (fromVersion < 12) {
          // De rondleiding komt erbij, en die is bedoeld voor wie de app nieuw
          // heeft. Dat er iets te migreren viel betekent dat deze telefoon de
          // app al gebruikte, dus die krijgt hem niet alsnog voor zijn kiezen;
          // onder Instellingen staat hij klaar voor wie hem wel wil zien.
          state.tourSeen = true;
        }

        if (fromVersion < 13) {
          // Vaste namen kunnen bij een speltak gaan horen, zodat je bij een
          // nieuwe avond per speltak kunt kiezen wie er bij komt. Wie er al
          // stond hoort nog bij geen enkele: die blijft gewoon in de lijst
          // staan en is te vinden onder "Alles" en "Zonder speltak". De
          // beheerder hangt ze er onder Instellingen zelf aan.
          state.sections = state.sections ?? [];
          state.defaultPeople = (state.defaultPeople ?? []).map((person: SavedPerson) => ({
            ...person,
            sectionId: person.sectionId ?? null,
          }));
        }

        if (fromVersion < 14) {
          // De app opent voortaan in de lopende rekening in plaats van in het
          // overzicht, en onthoudt welke het laatst was. Wie er nog nooit een
          // heeft geopend krijgt geen voorkeur; dan geldt de nieuwste.
          state.homeTabId = null;
        }

        if (fromVersion < 15) {
          // Streepjes in plaats van bedragen is nieuw en staat standaard uit:
          // een telefoon die de app al gebruikte ziet geen verschil.
          state.tallyMode = false;
        }

        return state;
      },
    }
  )
);

/**
 * De lijst waar de app mee opent: de lopende rekening die als laatste is
 * geopend, of anders de nieuwste. Undefined als deze telefoon er geen heeft.
 *
 * Alleen een lopende rekening telt. Een evenement is er één avond; wie de app
 * daarna opent wil niet in een feest van vorige maand terechtkomen. En met
 * meer dan één rekening is de laatst gebruikte de enige keuze die niemand
 * hoeft uit te leggen: wie de oude rekening gebruikt blijft daar, wie een
 * nieuw seizoen begint komt vanzelf bij de nieuwe uit.
 */
export function useHomeList(): AppEvent | undefined {
  return useStore((state) => {
    const tabs = state.events.filter((event) => event.kind === 'tab' && !event.demo);
    return tabs.find((event) => event.id === state.homeTabId) ?? tabs[0];
  });
}

/** Find one event by id, or undefined when the id is unknown. */
export function useEvent(eventId: string | undefined): AppEvent | undefined {
  return useStore((state) => state.events.find((event) => event.id === eventId));
}
