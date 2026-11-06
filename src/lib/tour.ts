/**
 * De rondleiding: wat hij vertelt, waar hij staat, en waar hij naar wijst.
 *
 * Streepje wordt achter de bar doorgegeven aan iemand die hem nog nooit heeft
 * gezien, en dan is turven wel duidelijk maar de rest niet: hoe je een streep
 * terugneemt, waar een rondje zit, dat al het andere achter het menu en de
 * beheercode staat. Dat uitleggen kostte elke keer iemand aan de bar.
 *
 * De rondleiding is voor de barploeg en blijft daarbij: het beginscherm, een
 * streep zetten, Rondje en het menu. Wat achter de beheercode zit (totalen,
 * logboek, delen, instellingen) legt hij niet uit; daar komt de barploeg niet.
 *
 * De rondleiding loopt daarom door de echte schermen en wijst de echte knoppen
 * aan, in plaats van tekeningen ervan te laten zien. Dat vraagt twee dingen:
 *
 *   1. Iets om langs te lopen. Op een verse telefoon is er niets -- geen
 *      lijsten, geen namen, geen turfjes -- en de knop Rondje bestaat pas
 *      binnen een lijst. De rondleiding maakt daarom
 *      zelf een voorbeeldlijst (zie `createDemoEvent` in store.ts) en ruimt
 *      die achteraf op. Die lijst gaat nooit de opslag in en nooit naar de
 *      server; waarom en hoe staat bij `demo` in types.ts.
 *   2. Weten waar een knop staat. Elke knop die aangewezen wordt meldt zijn
 *      plek op het scherm via `useAnchor` hieronder. Dat gebeurt opnieuw bij
 *      elke stap, want na het wisselen van scherm staat alles net ergens
 *      anders en vuurt `onLayout` niet uit zichzelf nog een keer.
 *
 * De overlay zelf staat in components/tour.tsx.
 */

import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { create } from 'zustand';

import { useStore } from './store';

/** Waar een aangewezen knop staat, in beeldpunten vanaf de hoek van het scherm. */
export type Anchor = { x: number; y: number; width: number; height: number };

/** De schermen waar de rondleiding langsgaat. */
export type TourScreen = 'event' | 'person';

export type TourStep = {
  screen: TourScreen;
  /**
   * Welke knop oplicht. Null betekent: geen gat, alleen het kaartje -- voor
   * een stap die over het hele scherm gaat in plaats van over één knop.
   */
  anchor: string | null;
  title: string;
  body: string;
};

/**
 * De namen waarmee een scherm zijn knoppen aanmeldt.
 *
 * Als tekst op één plek, zodat een typefout in een scherm niet stilletjes een
 * stap zonder spotlight oplevert.
 */
export const ANCHOR = {
  person: 'person',
  item: 'item',
  round: 'round',
  /** De drie puntjes in de kop van een lijst. */
  menu: 'menu',
} as const;

/**
 * Wat er te vertellen valt, in de volgorde waarin iemand het tegenkomt.
 *
 * Eén of twee zinnen per stap. Wie achter de bar staat leest dit staand, met
 * mensen die wachten; alles wat langer is wordt toch doorgetikt.
 */
export const STEPS: TourStep[] = [
  {
    screen: 'event',
    anchor: ANCHOR.person,
    title: 'Je streeplijst',
    body: 'Zo opent de app ook: meteen in je lijst, met iedereen die meedoet. Tik op een naam om voor die persoon te turven. Dit is een voorbeeld; hij verdwijnt zodra de rondleiding klaar is.',
  },
  {
    screen: 'person',
    anchor: ANCHOR.item,
    title: 'Turven is één tik',
    body: 'Tik op het vinkje en de consumptie staat erop, tegen de prijs van dat moment. Misgetikt? Onderin staat een paar seconden Ongedaan maken, ook als je al bij de volgende bent. Staat de tik eenmaal vast, dan haalt alleen een beheerder hem weg, met de correctiecode.',
  },
  {
    screen: 'event',
    anchor: ANCHOR.round,
    title: 'Tegelijk turven en een rondje',
    body: 'Bestelt iemand voor de hele tafel, ieder op zijn eigen rekening? Kies bij Tegelijk turven eerst het drankje en tik daarna alle namen aan. Geeft iemand een rondje? Kies bij Rondje wie geeft, wat en voor wie, en luid de bel. Alles komt op de rekening van de gever.',
  },
  {
    screen: 'event',
    anchor: ANCHOR.menu,
    title: 'Een naam erbij, en de rest',
    body: 'Achter de drie puntjes zet je bovenaan een naam erbij: een lid, een gast of Onbekend. Alles daaronder (totalen, logboek, delen, deze lijst, dit toestel en andere lijsten) is voor de beheerder en vraagt de beheercode.',
  },
];

type TourState = {
  active: boolean;
  step: number;
  /** De voorbeeldlijst waar de rondleiding doorheen loopt. */
  demoEventId: string | null;
  demoPersonId: string | null;
  anchors: Record<string, Anchor>;
  /** Zet de rondleiding aan. De voorbeeldlijst volgt met `setDemo`. */
  begin: () => void;
  setDemo: (eventId: string, personId: string) => void;
  next: () => void;
  stop: () => void;
  setAnchor: (id: string, anchor: Anchor) => void;
};

/**
 * Niet in de store van de app, en met opzet niet bewaard.
 *
 * Een halve rondleiding is niets om te onthouden: wie de app wegdrukt begint
 * hem gewoon opnieuw, en de voorbeeldlijst waar hij naar wijst heeft de
 * wegdruk toch niet overleefd.
 */
export const useTour = create<TourState>()((set) => ({
  active: false,
  step: 0,
  demoEventId: null,
  demoPersonId: null,
  anchors: {},

  begin: () => set({ active: true, step: 0, anchors: {} }),
  setDemo: (demoEventId, demoPersonId) => set({ demoEventId, demoPersonId }),
  next: () => set((state) => ({ step: Math.min(state.step + 1, STEPS.length - 1) })),
  stop: () =>
    set({ active: false, step: 0, demoEventId: null, demoPersonId: null, anchors: {} }),

  setAnchor: (id, anchor) =>
    set((state) => {
      const known = state.anchors[id];
      // Dezelfde plek niet opnieuw wegschrijven: elke stap laat alles opnieuw
      // meten, en zonder deze vergelijking zet dat de overlay aan het stuiteren.
      if (
        known &&
        known.x === anchor.x &&
        known.y === anchor.y &&
        known.width === anchor.width &&
        known.height === anchor.height
      ) {
        return state;
      }
      return { anchors: { ...state.anchors, [id]: anchor } };
    }),
}));

/**
 * Meld de plek van een knop aan, zodat de rondleiding hem kan aanwijzen.
 *
 * Geef het resultaat door aan de View of Pressable die moet oplichten. Met een
 * `id` van undefined doet dit niets, zodat een knop die ook buiten de
 * rondleiding bestaat er geen aparte variant voor nodig heeft.
 *
 * `collapsable` hoort erbij: Android mag een View die alleen maar iets omvat
 * weglaten uit de echte schermopbouw, en wat er niet staat kun je niet meten.
 */
export function useAnchor(id: string | undefined) {
  const ref = useRef<View>(null);
  const active = useTour((state) => state.active);
  const step = useTour((state) => state.step);
  const setAnchor = useTour((state) => state.setAnchor);

  const measure = useCallback(() => {
    if (!id) return;
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setAnchor(id, { x, y, width, height });
    });
  }, [id, setAnchor]);

  useEffect(() => {
    if (!id || !active) return;
    // Twee keer meten. De eerste is voor het gewone geval, de tweede vangt een
    // scherm op dat er nog niet klaar voor was: na een navigatie of een lijst
    // die eerst nog naar de goede plek schuift staat alles even verderop.
    const soon = setTimeout(measure, 120);
    const later = setTimeout(measure, 500);
    return () => {
      clearTimeout(soon);
      clearTimeout(later);
    };
  }, [id, active, step, measure]);

  return { ref, onLayout: measure, collapsable: false } as const;
}

/** Start de rondleiding, met een verse voorbeeldlijst om langs te lopen. */
export function useStartTour(): () => void {
  const createDemoEvent = useStore((state) => state.createDemoEvent);
  const begin = useTour((state) => state.begin);
  const setDemo = useTour((state) => state.setDemo);

  return useCallback(() => {
    // Twee keer starten is één rondleiding met twee voorbeeldlijsten. Dat
    // gebeurt eerder dan je denkt: React roept een effect in ontwikkelmodus
    // met opzet dubbel aan, en het beginscherm start de rondleiding vanuit
    // een effect.
    if (useTour.getState().active) return;

    // Eerst aanzetten, dan pas de voorbeeldlijst maken. Het beginscherm ruimt
    // een voorbeeldlijst op zodra er geen rondleiding loopt, en in de andere
    // volgorde zou die opruimer er net tussen kunnen komen.
    begin();
    const demo = createDemoEvent();
    setDemo(demo.eventId, demo.personId);
  }, [begin, createDemoEvent, setDemo]);
}
