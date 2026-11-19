/**
 * De tijd-uit van Beheer.
 *
 * De bar-iPad blijft vaak op het scherm staan waar iemand het laatst was. Staat
 * hij op Beheer, op Totalen of op het Logboek, dan ziet de volgende die langs
 * de bar loopt alle bedragen en namen, en dat is precies wat het slot moest
 * voorkomen. Daarom gaat de iPad zelf terug naar de lijst als er vijf minuten
 * niets is aangeraakt, en is de code daarna weer nodig.
 *
 * Eén klok voor het hele stuk achter de code. De Beheer-pagina zet hem aan zolang
 * hij open staat (ook als er een ander scherm bovenop ligt), en `noteTouch` wordt
 * bij elke aanraking in de app geroepen, vanuit de wortel in `_layout.tsx`.
 *
 * Alleen aanrakingen tellen, geen toetsen: wie lang aan het typen is raakt het
 * scherm ook aan, en vijf minuten is ruim.
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { lockCorrections } from './pin';
import { useHomeList } from './store';

export const IDLE_SECONDS = 300;

let lastTouch = Date.now();

export function noteTouch(): void {
  lastTouch = Date.now();
}

/** Zet de tijd-uit aan zolang het scherm dat dit aanroept bestaat. */
export function useBeheerIdle(): void {
  const router = useRouter();
  const home = useHomeList();
  const homeId = useRef<string | null>(null);
  homeId.current = home?.id ?? null;

  useEffect(() => {
    // Binnenkomen telt als aanraking: je tikte net op Beheer.
    noteTouch();

    const check = () => {
      if (Date.now() - lastTouch < IDLE_SECONDS * 1000) return;
      if (homeId.current) lockCorrections(homeId.current);
      router.dismissTo('/');
    };

    const timer = setInterval(check, 10_000);
    // Een iPad die uit de achtergrond komt wacht niet op de volgende tik van de klok.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [router]);
}
