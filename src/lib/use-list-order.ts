import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { activePeople, peopleForList } from './totals';
import type { AppEvent, Person } from './types';

/**
 * De volgorde van de namen, vastgehouden terwijl je turft.
 *
 * De volgorde hangt af van wie er streepjes heeft (zie `peopleForList`). Zou hij
 * live meebewegen, dan springt Fleur na haar eerste streep omhoog onder de
 * vinger van wie net op de volgende naam wilde tikken. Dus wordt hij maar op een
 * paar momenten opnieuw bepaald, en daartussen staat hij vast:
 *
 *  - als de lijst opent,
 *  - als het toestel uit de slaapstand of uit een andere app terugkomt (de
 *    bar-iPad staat dagen op dezelfde lijst, anders zou niemand ooit omhoog gaan),
 *  - als er iemand bij of af is gegaan.
 *
 * Tegelijk turven en Rondje lezen dezelfde volgorde mee (`refresh` uit), zodat
 * een naam daar op dezelfde plek staat als in de lijst waar je vandaan komt.
 */

type Frozen = { people: string; ids: string[] };

/** Per lijst, buiten React, zodat de schermen elkaars volgorde delen. */
const frozen = new Map<string, Frozen>();

/** Wie er meedoet, als sleutel: verandert er iets, dan klopt de volgorde niet meer. */
function peopleKey(event: AppEvent): string {
  return activePeople(event)
    .map((person) => person.id)
    .sort()
    .join('|');
}

function freeze(event: AppEvent): Frozen {
  const next = { people: peopleKey(event), ids: peopleForList(event).map((person) => person.id) };
  frozen.set(event.id, next);
  return next;
}

/**
 * @param refresh  Waar `true`: bepaal de volgorde opnieuw bij het openen en als
 *                 het toestel terugkomt. Dat is het werk van de lijst zelf. Waar
 *                 `false` leest het scherm mee wat de lijst vastlegde.
 */
export function useListOrder(event: AppEvent | undefined, refresh: boolean): Person[] {
  const eventId = event?.id;
  // Eén keer bij het openen: de oude volgorde weggooien. Gebeurt in de
  // initiële waarde zodat het vóór de eerste weergave klaar is.
  const [, setTick] = useState(() => {
    if (refresh && eventId) frozen.delete(eventId);
    return 0;
  });

  useEffect(() => {
    if (!refresh || !eventId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      frozen.delete(eventId);
      setTick((tick) => tick + 1);
    });
    return () => subscription.remove();
  }, [refresh, eventId]);

  if (!event) return [];

  let current = frozen.get(event.id);
  if (!current || current.people !== peopleKey(event)) current = freeze(event);

  const position = new Map(current.ids.map((id, index) => [id, index]));
  return activePeople(event)
    .slice()
    .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}
