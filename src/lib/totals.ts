/**
 * Pure calculation helpers. They take data in and give numbers back; they never
 * touch the store or the screen, which makes them easy to reason about.
 *
 * Everything here derives from the order log, so a total is always the sum of
 * entries rather than a number someone remembered to keep up to date.
 */

import type { AppEvent, MenuItem, OrderEntry, Person } from './types';

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

/** People still part of the event. Removed ones are kept, but do not count. */
export function activePeople(event: AppEvent): Person[] {
  return event.people.filter((person) => person.removedAt === null);
}

/** People taken off the event, newest removal last. */
export function removedPeople(event: AppEvent): Person[] {
  return event.people
    .filter((person) => person.removedAt !== null)
    .sort((a, b) => (a.removedAt ?? 0) - (b.removedAt ?? 0));
}

/** Items still offered. Hidden ones keep their price for past turfs. */
export function activeMenu(event: AppEvent): MenuItem[] {
  return event.menu.filter((item) => !item.hidden);
}

export function eventTotalCents(event: AppEvent): number {
  return activePeople(event).reduce((sum, person) => sum + personTotalCents(event, person.id), 0);
}

/** What one person still owes. Never negative: overpaying is not a debt. */
export function personOutstandingCents(event: AppEvent, person: Person): number {
  return Math.max(0, personTotalCents(event, person.id) - person.paidCents);
}

/** Settled when nothing is left owing, which changes again if they order more. */
export function isSettled(event: AppEvent, person: Person): boolean {
  return personOutstandingCents(event, person) === 0;
}

/** Money actually collected. */
export function eventPaidCents(event: AppEvent): number {
  return activePeople(event).reduce((sum, person) => sum + person.paidCents, 0);
}

/**
 * Money still to come in.
 *
 * Summed per person rather than taken from the grand total, so someone who
 * overpaid cannot quietly cancel out what somebody else still owes.
 */
export function eventOutstandingCents(event: AppEvent): number {
  return activePeople(event).reduce(
    (sum, person) => sum + personOutstandingCents(event, person),
    0
  );
}

/**
 * Every removal, newest last.
 *
 * Corrections are ordinary rows with a negative delta, so they were always in
 * the data -- they were simply never shown. Surfacing them is half of what
 * makes removals safe: the PIN stops a casual removal, and this makes any
 * removal that does happen impossible to hide.
 */
export function corrections(event: AppEvent, personId?: string): OrderEntry[] {
  return event.entries
    .filter((entry) => entry.delta < 0 && (personId === undefined || entry.personId === personId))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** How many individual turfs have been taken off, across the whole event. */
export function correctionCount(event: AppEvent): number {
  return corrections(event).reduce((sum, entry) => sum - entry.delta, 0);
}

/** Who this phone is, so its own older entries can still be recognised. */
export type LocalDevice = {
  deviceId: string;
  deviceName: string | null;
};

/**
 * How to name the phone that logged an entry, for someone reading the record.
 *
 * Normally this is the name that phone carried at the time, copied onto the
 * entry when it was written, so a later rename cannot revise history.
 *
 * Entries written before naming existed carry nothing. Where such an entry
 * came from the phone doing the reading, its current name is used instead:
 * inferred rather than recorded, but far more use than a fragment of an id.
 * Anything else falls back to that fragment, which at least tells two phones
 * apart.
 */
export function deviceLabel(entry: OrderEntry, local?: LocalDevice): string {
  if (entry.deviceName && entry.deviceName.trim() !== '') return entry.deviceName;

  if (local && entry.deviceId === local.deviceId) {
    return local.deviceName && local.deviceName.trim() !== ''
      ? local.deviceName
      : 'deze telefoon';
  }

  return `telefoon ${entry.deviceId.slice(0, 6)}`;
}
