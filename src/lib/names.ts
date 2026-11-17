/**
 * Is deze naam al op de lijst?
 *
 * Een naam wordt verschillend getypt: "jan de vries", "Jan  de Vries" en "Jan de
 * Vries " zijn dezelfde man, en op de factuur moet hij één regel zijn. Daarom
 * wordt er vergeleken zonder hoofdletters, accenten en dubbele spaties.
 *
 * Los van de schermen gehouden, zodat de regel op één plek staat en in gewone
 * Node te testen is.
 */

import type { AppEvent, Person } from './types';

/** De naam zoals hij vergeleken wordt. */
export function nameKey(name: string): string {
  let text = name.trim().toLowerCase().replace(/\s+/g, ' ');
  // Accenten weghalen: Zoë is Zoe. Kent een toestel `normalize` niet, dan blijft
  // de naam zoals hij is, en dat vergelijkt nog steeds zonder hoofdletters.
  try {
    if (typeof text.normalize === 'function') {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
  } catch {
    // laten staan
  }
  return text;
}

/**
 * Wie er al zo heet in deze lijst. Eerst wie nog meedoet; alleen als er niemand
 * is, wie eerder is verwijderd.
 *
 * `exceptId` is de persoon die je hernoemt: die mag zijn eigen naam houden.
 */
export function findSameName(
  event: AppEvent,
  name: string,
  exceptId?: string
): { person: Person; removed: boolean } | null {
  const key = nameKey(name);
  if (key === '') return null;
  const same = event.people.filter(
    (person) => person.id !== exceptId && nameKey(person.name) === key
  );
  const active = same.find((person) => person.removedAt === null);
  if (active) return { person: active, removed: false };
  const removed = same[0];
  return removed ? { person: removed, removed: true } : null;
}

/** Hoeveel letters je moet wijzigen, toevoegen of weghalen om van de ene naar de andere te komen. */
function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Voorstellen voor wat er getypt wordt, uit de namen die er al zijn.
 *
 * Zonder hoofdletters, accenten en dubbele spaties. In volgorde van hoe goed het
 * past: wat begint met wat je typte, dan elk getypt woord als begin van een woord
 * in de naam ("anne de" vindt Anne de Boer), dan ergens in de naam, en als laatste
 * met een tikfout ("Jan de Vris" vindt Jan de Vries).
 *
 * Een tikfout wordt alleen toegestaan bij woorden van minstens vier letters:
 * korte woorden (jan, van, pim) zijn te vaag, en vinden dan elke andere korte naam.
 * Alles gebeurt op het toestel, op de namen die het al heeft.
 */
export function suggestNames<T extends { name: string }>(
  query: string,
  candidates: T[],
  limit = 5
): T[] {
  const key = nameKey(query);
  if (key === '') return [];
  const typed = key.split(' ');

  const scored: { item: T; score: number; name: string }[] = [];
  for (const item of candidates) {
    const full = nameKey(item.name);
    const words = full.split(' ');
    let score = -1;
    if (full.startsWith(key)) score = 0;
    else if (typed.every((word) => words.some((own) => own.startsWith(word)))) score = 1;
    else if (full.includes(key)) score = 2;
    else {
      const close = typed.every(
        (word) =>
          word.length >= 4 &&
          words.some(
            (own) =>
              editDistance(word, own.slice(0, word.length + 1)) <= 1 || editDistance(word, own) <= 1
          )
      );
      if (close || (key.length >= 6 && editDistance(key, full) <= 2)) score = 3;
    }
    if (score >= 0) scored.push({ item, score, name: item.name });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'nl'))
    .slice(0, limit)
    .map((entry) => entry.item);
}
