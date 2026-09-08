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

import type {
  AppEvent,
  MenuItem,
  OrderEntry,
  Person,
  PinRecord,
  SavedPerson,
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
  events: AppEvent[];
  /** The menu that newly created events start from. */
  defaultMenu: MenuItem[];
  /**
   * Names kept between events. The same people turn up most weeks, and typing
   * them in again each time is the slowest part of setting an event up.
   */
  defaultPeople: SavedPerson[];

  createEvent: (name: string) => string;
  renameEvent: (eventId: string, name: string) => void;
  deleteEvent: (eventId: string) => void;
  setEventClosed: (eventId: string, closed: boolean) => void;

  addPerson: (eventId: string, name: string) => void;
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

  addDefaultPerson: (name: string) => void;
  renameDefaultPerson: (personId: string, name: string) => void;
  removeDefaultPerson: (personId: string) => void;

  addDefaultItem: (draft: Omit<MenuItem, 'id'>) => void;
  updateDefaultItem: (itemId: string, patch: Partial<Omit<MenuItem, 'id'>>) => void;
  removeDefaultItem: (itemId: string) => void;

  // --- used by the sync engine -------------------------------------------

  setDeviceName: (name: string) => void;
  setShare: (eventId: string, share: ShareInfo | null) => void;
  /** Set or replace the PIN that guards removing a turf. */
  setCorrectionPin: (eventId: string, pin: PinRecord | null) => void;
  /** Take an event that exists on the server and put it on this device. */
  adoptRemoteEvent: (event: AppEvent) => void;
  /** Fold in rows the server has that this device does not. */
  mergeRemoteEntries: (eventId: string, entries: OrderEntry[]) => void;
  /** Replace the parts that are edited rather than appended. */
  mergeRemoteDetails: (
    eventId: string,
    details: { name: string; closed: boolean; people: Person[]; menu: MenuItem[] }
  ) => void;
  markEntriesSynced: (eventId: string, entryIds: string[]) => void;
  noteSynced: (eventId: string) => void;
};

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      deviceId: newId(),
      deviceName: null,
      events: [],
      defaultMenu: withIds(STARTER_MENU),
      defaultPeople: [],

      createEvent: (name) => {
        const id = newId();
        const event: AppEvent = {
          id,
          name: name.trim() || 'Naamloos evenement',
          createdAt: Date.now(),
          people: [],
          // Copy the default menu and give each item a fresh id, so editing this
          // event's menu never reaches back and changes the template.
          menu: get().defaultMenu.map((item) => ({ ...item, id: newId() })),
          entries: [],
          unsyncedEntryIds: [],
          closed: false,
          share: null,
          correctionPin: null,
        };
        set({ events: [event, ...get().events] });
        return id;
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

      setEventClosed: (eventId, closed) =>
        set({ events: mapEvent(get().events, eventId, (event) => ({ ...event, closed })) }),

      addPerson: (eventId, name) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            const person: Person = {
              id: newId(),
              name: name.trim() || 'Iemand',
              paidCents: 0,
              paidAt: null,
              removedAt: null,
              removedBy: null,
            };
            return { ...event, people: [...event.people, person] };
          }),
        }),

      addPeople: (eventId, names) =>
        set({
          events: mapEvent(get().events, eventId, (event) => {
            const taken = new Set(event.people.map((person) => person.name.toLowerCase()));
            const fresh = names
              .map((name) => name.trim())
              .filter((name) => name !== '' && !taken.has(name.toLowerCase()))
              .map((name) => ({
                id: newId(),
                name,
                paidCents: 0,
                paidAt: null,
                removedAt: null,
                removedBy: null,
              }));
            return { ...event, people: [...event.people, ...fresh] };
          }),
        }),

      addUnknownPerson: (eventId) => {
        const id = newId();
        set({
          events: mapEvent(get().events, eventId, (event) => {
            // Numbered so several unknowns in one evening stay apart until
            // someone remembers who they were.
            const used = event.people.filter((person) => /^Onbekend( d+)?$/.test(person.name));
            const person: Person = {
              id,
              name: `Onbekend ${used.length + 1}`,
              paidCents: 0,
              paidAt: null,
              removedAt: null,
              removedBy: null,
            };
            return { ...event, people: [...event.people, person] };
          }),
        });
        return id;
      },

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
            const entry: OrderEntry = {
              id: newId(),
              personId,
              itemId,
              delta,
              deviceId: get().deviceId,
              deviceName: get().deviceName,
              createdAt: Date.now(),
            };
            return {
              ...event,
              entries: [...event.entries, entry],
              unsyncedEntryIds: [...event.unsyncedEntryIds, entry.id],
            };
          }),
        }),

      addDefaultPerson: (name) =>
        set({
          defaultPeople: [...get().defaultPeople, { id: newId(), name: name.trim() || 'Iemand' }],
        }),

      renameDefaultPerson: (personId, name) =>
        set({
          defaultPeople: get().defaultPeople.map((person) =>
            person.id === personId ? { ...person, name: name.trim() || person.name } : person
          ),
        }),

      removeDefaultPerson: (personId) =>
        set({ defaultPeople: get().defaultPeople.filter((person) => person.id !== personId) }),

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

      setDeviceName: (deviceName) => set({ deviceName: deviceName.trim() || null }),

      setShare: (eventId, share) =>
        set({ events: mapEvent(get().events, eventId, (event) => ({ ...event, share })) }),

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
            const known = new Set(event.entries.map((entry) => entry.id));
            const fresh = incoming.filter((entry) => !known.has(entry.id));
            if (fresh.length === 0) return event;
            return {
              ...event,
              entries: [...event.entries, ...fresh].sort((a, b) => a.createdAt - b.createdAt),
            };
          }),
        }),

      mergeRemoteDetails: (eventId, details) =>
        set({
          events: mapEvent(get().events, eventId, (event) => ({
            ...event,
            name: details.name,
            closed: details.closed,
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
      version: 7,
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

        return state;
      },
    }
  )
);

/** Find one event by id, or undefined when the id is unknown. */
export function useEvent(eventId: string | undefined): AppEvent | undefined {
  return useStore((state) => state.events.find((event) => event.id === eventId));
}
