/**
 * Pure calculation helpers. They take data in and give numbers back; they never
 * touch the store or the screen, which makes them easy to reason about.
 *
 * Everything here derives from the order log, so a total is always the sum of
 * entries rather than a number someone remembered to keep up to date.
 */

import type { AppEvent, MenuItem } from './types';

export type Line = {
  item: MenuItem;
  quantity: number;
  lineCents: number;
};

/**
 * How many of each item one person has had: itemId -> quantity.
 *
 * Build this once per screen and read from it, rather than calling
 * `quantityFor` in a loop over the menu.
 */
export function quantities(event: AppEvent, personId: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of event.entries) {
    if (entry.personId !== personId) continue;
    result[entry.itemId] = (result[entry.itemId] ?? 0) + entry.delta;
  }
  return result;
}

/**
 * Quantity of a single item for one person.
 *
 * Clamped at zero: corrections can in principle out-number orders if two
 * devices both correct the same mistake while offline, and a negative count
 * would be nonsense on screen.
 */
export function quantityFor(event: AppEvent, personId: string, itemId: string): number {
  let total = 0;
  for (const entry of event.entries) {
    if (entry.personId === personId && entry.itemId === itemId) total += entry.delta;
  }
  return Math.max(0, total);
}

/** Every item one person consumed, with the money each line adds up to. */
export function personLines(event: AppEvent, personId: string): Line[] {
  const counts = quantities(event, personId);
  return event.menu
    .filter((item) => (counts[item.id] ?? 0) > 0)
    .map((item) => {
      const quantity = counts[item.id];
      return { item, quantity, lineCents: quantity * item.priceCents };
    });
}

export function personTotalCents(event: AppEvent, personId: string): number {
  const counts = quantities(event, personId);
  return event.menu.reduce(
    (sum, item) => sum + Math.max(0, counts[item.id] ?? 0) * item.priceCents,
    0
  );
}

/** How many things one person has had in total, regardless of price. */
export function personItemCount(event: AppEvent, personId: string): number {
  const counts = quantities(event, personId);
  return Object.values(counts).reduce((sum, quantity) => sum + Math.max(0, quantity), 0);
}

export function eventTotalCents(event: AppEvent): number {
  return event.people.reduce((sum, person) => sum + personTotalCents(event, person.id), 0);
}

/** Money already collected. */
export function eventPaidCents(event: AppEvent): number {
  return event.people
    .filter((person) => person.paid)
    .reduce((sum, person) => sum + personTotalCents(event, person.id), 0);
}

/** Money still to come in. */
export function eventOutstandingCents(event: AppEvent): number {
  return eventTotalCents(event) - eventPaidCents(event);
}
