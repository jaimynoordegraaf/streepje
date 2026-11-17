/**
 * Strepen die nog niet vaststaan: het bezoek aan een persoonsscherm, en daarna
 * een paar seconden bedenktijd.
 *
 * Een streep wordt pas een echte regel in het log als hij hier weg mag. Tot dan
 * staat hij op deze telefoon, niet in `entries`, niet in de wachtrij naar
 * Supabase en dus nooit op een andere telefoon. Terugnemen gooit hem weg; er is
 * niets om te verwijderen, dus er komt ook geen weg-haal-weg in de opslag van
 * het log. Wat eenmaal vaststaat gaat nog steeds alleen weg met de
 * correctiecode (zie pin.ts en de guard-triggers in supabase/).
 *
 * Twee fasen:
 *
 *   1. Het bezoek (`open`). Zolang het persoonsscherm openstaat telt elke ✓ bij
 *      één wachtende regel per drankje op: 3× Bier is één regel met `delta` 3.
 *      Er loopt geen klok; ✕ neemt er één weer af, zonder code. De regel houdt de
 *      tijd en de prijs van de eerste tik van dat drankje in dit bezoek.
 *   2. De bedenktijd. Sluit het scherm, dan blijft elke regel nog BEDENKTIJD_MS
 *      te zien in de strook "Ongedaan maken" (zie undo-strip.tsx) en kan hij als
 *      geheel worden teruggenomen. Alles wat dan wacht deelt één klok; om
 *      doortikken niet eindeloos te laten wachten staat de oudste regel
 *      uiterlijk LANGSTE_WACHT_MS na het sluiten vast.
 *
 * Alles wordt bewaard in een eigen sleutel, los van de hoofdopslag, bij elke
 * tik. Bij de volgende start gaat alles vast, ook een bezoek dat nog openstond:
 * een streep verdwijnt zo nooit stil als de app wordt gesloten of crasht.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { buildEntry, useStore } from './store';
import type { AppEvent, OrderEntry } from './types';

/** Zo lang kun je een gesloten bezoek terugnemen, gerekend vanaf het sluiten. */
export const BEDENKTIJD_MS = 5000;
/** Zo lang wacht de oudste regel hoogstens, hoe druk het ook is. */
export const LANGSTE_WACHT_MS = 15000;

export type Waiting = {
  eventId: string;
  /** Eén regel per drankje; `delta` is het aantal van dit bezoek. */
  entry: OrderEntry;
  /** Het persoonsscherm staat nog open: geen klok, ✕ werkt zonder code. */
  open?: boolean;
  /** Wanneer het scherm sloot (ms sinds 1970); alleen voor een gesloten regel. */
  closedAt?: number;
};

type PendingState = {
  waiting: Waiting[];
  /** Wanneer de klok afloopt (ms sinds 1970); null als er niets in bedenktijd is. */
  deadline: number | null;
  /** Telt bij elke nieuwe klok op, zodat de strook zijn balk opnieuw laat lopen. */
  restarts: number;
  /** Een streep zetten voor dit bezoek. */
  add: (eventId: string, personId: string, itemId: string) => void;
  /** Een streep van dit bezoek terugnemen; het aantal gaat met één omlaag. */
  takeBack: (eventId: string, personId: string, itemId: string) => void;
  /** Het scherm is gesloten: het bezoek gaat de bedenktijd in. */
  closeVisit: (eventId: string, personId: string) => void;
  /** Eén gesloten regel (de hele regel) terugnemen. */
  undo: (entryId: string) => void;
  /** Alles wat wacht nu vastzetten, ook een bezoek dat nog openstaat. */
  commitAll: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Leg regels vast in het log. Wie wil leegmaken doet dat pas daarna. */
function commit(items: Waiting[]) {
  const perEvent = new Map<string, OrderEntry[]>();
  for (const item of items) {
    perEvent.set(item.eventId, [...(perEvent.get(item.eventId) ?? []), item.entry]);
  }
  for (const [eventId, entries] of perEvent) {
    useStore.getState().commitEntries(eventId, entries);
  }
}

export const usePending = create<PendingState>()(
  persist(
    (set, get) => {
      /** Zet de klok voor alles wat in bedenktijd is, of stop hem als er niets is. */
      const rearm = (): Partial<PendingState> => {
        stopTimer();
        const closed = get().waiting.filter((item) => !item.open);
        if (closed.length === 0) return { deadline: null };
        const now = Date.now();
        const oldest = Math.min(...closed.map((item) => item.closedAt ?? now));
        const left = Math.max(0, Math.min(BEDENKTIJD_MS, LANGSTE_WACHT_MS - (now - oldest)));
        timer = setTimeout(() => {
          // Alleen wat in bedenktijd is. Een bezoek dat openstaat (iemand is al
          // aan een volgende persoon begonnen) mag niet worden vastgezet.
          const done = get().waiting.filter((item) => !item.open);
          if (done.length === 0) return;
          commit(done);
          set({ waiting: get().waiting.filter((item) => item.open), deadline: null });
        }, left);
        return { deadline: now + left, restarts: get().restarts + 1 };
      };

      const sameLine = (eventId: string, personId: string, itemId: string) => (item: Waiting) =>
        item.open === true &&
        item.eventId === eventId &&
        item.entry.personId === personId &&
        item.entry.itemId === itemId;

      return {
        waiting: [],
        deadline: null,
        restarts: 0,

        add: (eventId, personId, itemId) => {
          const root = useStore.getState();
          const event = root.events.find((candidate) => candidate.id === eventId);
          // Een afgesloten lijst neemt geen turven meer aan.
          if (!event || event.closed) return;

          const waiting = get().waiting;
          const at = waiting.findIndex(sameLine(eventId, personId, itemId));
          if (at >= 0) {
            // Zelfde regel, één erbij: id, tijd en prijs blijven die van de eerste tik.
            const next = [...waiting];
            next[at] = { ...next[at], entry: { ...next[at].entry, delta: next[at].entry.delta + 1 } };
            set({ waiting: next });
          } else {
            const entry = buildEntry(event, root.deviceId, root.deviceName, personId, itemId, 1);
            set({ waiting: [...waiting, { eventId, entry, open: true }] });
          }
        },

        takeBack: (eventId, personId, itemId) => {
          const waiting = get().waiting;
          const at = waiting.findIndex(sameLine(eventId, personId, itemId));
          if (at < 0) return;
          const next = [...waiting];
          if (next[at].entry.delta <= 1) next.splice(at, 1);
          else next[at] = { ...next[at], entry: { ...next[at].entry, delta: next[at].entry.delta - 1 } };
          set({ waiting: next });
        },

        closeVisit: (eventId, personId) => {
          const now = Date.now();
          const mine = (item: Waiting) =>
            item.open === true && item.eventId === eventId && item.entry.personId === personId;
          if (!get().waiting.some(mine)) return;
          set({
            waiting: get().waiting.map((item) =>
              mine(item) ? { ...item, open: false, closedAt: now } : item
            ),
          });
          set(rearm());
        },

        undo: (entryId) => {
          const waiting = get().waiting.filter((item) => item.open || item.entry.id !== entryId);
          if (waiting.length === get().waiting.length) return;
          set({ waiting });
          // De klok loopt door voor wat er nog in bedenktijd is; is er niets
          // meer, dan stopt hij.
          if (!waiting.some((item) => !item.open)) {
            stopTimer();
            set({ deadline: null });
          }
        },

        commitAll: () => {
          stopTimer();
          const { waiting } = get();
          if (waiting.length === 0) {
            if (get().deadline !== null) set({ deadline: null });
            return;
          }
          // Eerst vastleggen, dan pas leegmaken: gaat het vastleggen mis, dan
          // staat de streep nog hier en niet nergens.
          commit(waiting);
          set({ waiting: [], deadline: null });
        },
      };
    },
    {
      name: 'turf-pending-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // De klok zelf hoort niet bewaard te worden; bij de start gaat alles vast.
      partialize: (state) => ({ waiting: state.waiting }),
    }
  )
);

/**
 * Zet wat er van de vorige keer is blijven wachten vast.
 *
 * Pas aanroepen als de hoofdopslag is geladen: de regels horen in een lijst die
 * er dan moet zijn. Is die lijst intussen weggehaald, dan gaat de streep mee
 * (net als elke turf voor een lijst die niet meer bestaat).
 */
export function flushPendingAfterStart() {
  if (usePending.persist.hasHydrated()) {
    usePending.getState().commitAll();
  } else {
    usePending.persist.onFinishHydration(() => usePending.getState().commitAll());
  }
}

/**
 * De lijst zoals hij eruit ziet met wat er nog wacht erbij, voor tellen en
 * bedragen op het scherm. Alleen om te laten zien: wat vaststaat (Totalen, de
 * exports, het delen) blijft uit `entries` komen.
 */
export function useWithPending(event: AppEvent | undefined): AppEvent | undefined {
  const waiting = usePending((state) => state.waiting);
  return useMemo(() => {
    if (!event) return event;
    const mine = waiting.filter((item) => item.eventId === event.id);
    if (mine.length === 0) return event;
    // Een streep die net is vastgezet staat even in beide; één keer tellen.
    const known = new Set(event.entries.map((entry) => entry.id));
    const extra = mine.map((item) => item.entry).filter((entry) => !known.has(entry.id));
    return extra.length === 0 ? event : { ...event, entries: [...event.entries, ...extra] };
  }, [event, waiting]);
}
