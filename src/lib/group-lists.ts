/**
 * Waar een lijst staat ten opzichte van de groep, in woorden.
 *
 * Delen is geen los begrip meer: een lijst zit in de groep, of nog niet. Wat
 * er overblijft om te zeggen, staat hier, zodat Beheer, het Groep-scherm en het
 * scherm van één lijst hetzelfde zeggen.
 *
 * Bewust zonder Expo of React, zodat dit in gewone Node te proberen is.
 */

import { timeAgo } from './share-status';
import type { AppEvent } from './types';

/**
 * Wat een toestel uit de groeps-QR leest. Een eigen vorm, zodat de app een
 * groepscode nooit verwart met de code van een oude losse lijst. Met de camera
 * van de telefoon zelf gescand, opent hij streepje op het meedoen-scherm.
 */
export const groupJoinUrl = (code: string) => `streepje://groep/meedoen?code=${code}`;

/** Haal een groepscode uit wat er gescand of getypt is. */
export function groupCodeFrom(raw: string): string | null {
  const text = raw.trim();
  const fromUrl = text.match(/code=([A-Z0-9]{4,12})/i);
  if (fromUrl) return fromUrl[1].toUpperCase();
  if (/^[A-Z0-9]{6}$/i.test(text)) return text.toUpperCase();
  return null;
}

export type ListPlace =
  /** In de groep van dit toestel. */
  | 'group'
  /** Moet nog de groep in, zodra er verbinding is. */
  | 'pending'
  /** Vroeger met een losse code gedeeld, maar niet in de groep. */
  | 'code'
  /** Staat alleen op dit toestel. */
  | 'local'
  /** Hoort bij een andere groep dan die van dit toestel. */
  | 'other';

export function listPlace(event: AppEvent, groupId: string | null): ListPlace {
  if (event.groupId) return event.groupId === groupId ? 'group' : 'other';
  if (event.groupPending) return 'pending';
  return event.share ? 'code' : 'local';
}

export function placeLabel(place: ListPlace): string {
  switch (place) {
    case 'group':
      return 'In de groep';
    case 'pending':
      return 'Gaat de groep in zodra er verbinding is';
    case 'code':
      return 'Gedeeld met een losse code';
    case 'local':
      return 'Alleen op dit toestel';
    case 'other':
      return 'Hoort bij een andere groep';
  }
}

/**
 * Eén regel voor een lijst op dit toestel: afgesloten, wat er nog wacht, en
 * wanneer de server voor het laatst bereikt is.
 */
export function listStatusLine(event: AppEvent, groupId: string | null, now: number): string {
  const place = listPlace(event, groupId);
  const bits: string[] = [];
  if (event.closed) bits.push('Afgesloten');
  if (place !== 'group') bits.push(placeLabel(place));
  const pending = event.unsyncedEntryIds.length;
  if (event.share && pending > 0) bits.push(`${pending} nog te versturen`);
  if (event.share) {
    const last = event.share.lastSyncedAt;
    bits.push(last === null ? 'nog nooit verbonden' : `laatst verbonden ${timeAgo(last, now)}`);
  }
  return bits.join(' · ');
}

/** Wat de database op Engels terugzegt, in de taal van de app. */
export function groupErrorText(message: string): string | null {
  if (message.includes('last admin of this group')) {
    return 'Dit toestel is de enige groepsbeheerder. Maak eerst een ander toestel groepsbeheerder, anders kan niemand de groep nog beheren.';
  }
  if (message.includes('at least one admin')) {
    return 'Een groep houdt altijd minstens één groepsbeheerder.';
  }
  if (message.includes('not in this group')) {
    return 'Dat toestel zit niet (meer) in de groep.';
  }
  if (message.includes('Only a group admin')) {
    return 'Alleen een groepsbeheerder kan dit. Misschien is dit toestel net geen groepsbeheerder meer.';
  }
  if (message.includes('Only an admin may delete')) {
    return 'Alleen een beheerder van deze lijst of een groepsbeheerder kan hem verwijderen.';
  }
  if (message.includes('No group with that code')) {
    return 'Geen groep met die code. Let op: de code van een losse lijst werkt hier niet, alleen een groepscode.';
  }
  if (message.includes('Could not find the function') || message.includes('PGRST202')) {
    return 'De server kent dit nog niet. De database moet eerst worden bijgewerkt (migratie 022).';
  }
  return null;
}
