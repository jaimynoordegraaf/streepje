/**
 * Strepen die nog even kunnen worden teruggenomen.
 *
 * Een tik wordt pas een echte regel in het log als de bedenktijd om is. Tot
 * dan staat hij hier: op deze telefoon, niet in `entries`, niet in de wachtrij
 * naar Supabase en dus nooit op een andere telefoon. Ongedaan maken gooit hem
 * weg; er is niets om te verwijderen, dus er komt ook geen weg-haal-weg in de
 * opslag van het log. Wat eenmaal vaststaat gaat nog steeds alleen weg met de
 * correctiecode (zie pin.ts en de guard-triggers in supabase/).
 *
 * Alles wat wacht deelt één klok. Elke nieuwe streep zet hem terug op
 * BEDENKTIJD_MS, zodat een eerdere streep nooit vastgezet wordt omdat er een
 * nieuwe bij komt. Om te voorkomen dat doortikken alles eindeloos laat wachten
 * staat de oudste streep uiterlijk LANGSTE_WACHT_MS na zijn tik vast.
 *
 * De wachtende strepen worden bewaard in een eigen sleutel, los van de
 * hoofdopslag, en bij de volgende start vastgezet: een streep verdwijnt zo nooit
 * stil als de app wordt gesloten of crasht. De regel behoudt de tijd, de prijs
 * en de telefoon van de tik zelf.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { buildEntry, useStore } from './store';
import type { AppEvent, OrderEntry } from './types';

/** Zo lang kun je een streep terugnemen, gerekend vanaf de laatste streep. */
export const BEDENKTIJD_MS = 5000;
/** Zo lang wacht de oudste streep hoogstens, hoe druk het ook is. */
export const LANGSTE_WACHT_MS = 15000;

export type Waiting = { eventId: string; entry: OrderEntry };

type PendingState = {
  waiting: Waiting[];
  /** Wanneer de klok afloopt (ms sinds 1970); null als er niets wacht. */
  deadline: number | null;
  /** Telt bij elke streep op, zodat de strook zijn klok opnieuw laat lopen. */
  restarts: number;
  /** Een streep zetten; hij wacht tot de klok om is. */
  add: (eventId: string, personId: string, itemId: string) => void;
  /** Eén wachtende streep terugnemen. */
  undo: (entryId: string) => void;
  /** Alles wat wacht nu vastzetten. */
  commitAll: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export const usePending = create<PendingState>()(
  persist(
    (set, get) => ({
      waiting: [],
      deadline: null,
      restarts: 0,

      add: (eventId, personId, itemId) => {
        const root = useStore.getState();
        const event = root.events.find((candidate) => candidate.id === eventId);
        // Een afgesloten lijst neemt geen turven meer aan.
        if (!event || event.closed) return;

        const entry = buildEntry(event, root.deviceId, root.deviceName, personId, itemId, 1);
        const waiting = [...get().waiting, { eventId, entry }];

        const now = Date.now();
        const oldest = waiting[0].entry.createdAt;
        const left = Math.max(0, Math.min(BEDENKTIJD_MS, LANGSTE_WACHT_MS - (now - oldest)));

        stopTimer();
        timer = setTimeout(() => get().commitAll(), left);
        set({ waiting, deadline: now + left, restarts: get().restarts + 1 });
      },

      undo: (entryId) => {
        const waiting = get().waiting.filter((item) => item.entry.id !== entryId);
        if (waiting.length === get().waiting.length) return;
        // De klok loopt door voor wat er nog wacht; is er niets meer, dan stopt hij.
        if (waiting.length === 0) {
          stopTimer();
          set({ waiting, deadline: null });
        } else {
          set({ waiting });
        }
      },

      commitAll: () => {
        stopTimer();
        const { waiting } = get();
        if (waiting.length === 0) {
          if (get().deadline !== null) set({ deadline: null });
          return;
        }

        const perEvent = new Map<string, OrderEntry[]>();
        for (const item of waiting) {
          perEvent.set(item.eventId, [...(perEvent.get(item.eventId) ?? []), item.entry]);
        }
        // Eerst vastleggen, dan pas leegmaken: gaat het vastleggen mis, dan
        // staat de streep nog hier en niet nergens.
        for (const [eventId, entries] of perEvent) {
          useStore.getState().commitEntries(eventId, entries);
        }
        set({ waiting: [], deadline: null });
      },
    }),
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
