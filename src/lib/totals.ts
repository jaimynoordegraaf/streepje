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
  /** What one of these cost when it was turfed. */
  unitCents: number;
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

/**
 * The price of every turf one person still has, oldest first: itemId -> prices.
 *
 * Each turf keeps the price it was charged at, so a menu change only affects
 * what is turfed afterwards.
 *
 * How many remain is the plain sum of the deltas, exactly as before, so the
 * count never depends on the order entries arrived in. Which ones remain is
 * the oldest: a correction takes off the most recent turf, the one a slip of
 * the finger just added. That matters once prices differ -- a correction
 * priced at today's price would not cancel a turf made at last month's, and
 * would leave a few cents behind on someone's tab.
 *
 * Ties on time fall back to the entry id, so every phone keeps the same turfs
 * and arrives at the same total.
 */
function remainingPrices(event: AppEvent, personId: string): Map<string, number[]> {
  const menuPrice = new Map(event.menu.map((item) => [item.id, item.priceCents]));
  const net = new Map<string, number>();
  const turfs = new Map<string, { at: number; id: string; price: number }[]>();

  for (const entry of event.entries) {
    if (entry.personId !== personId) continue;
    net.set(entry.itemId, (net.get(entry.itemId) ?? 0) + entry.delta);
    if (entry.delta <= 0) continue;

    // Entries from before prices were recorded count at the menu price, which
    // is what they were always counted at.
    const price = entry.priceCents ?? menuPrice.get(entry.itemId) ?? 0;
    const list = turfs.get(entry.itemId) ?? [];
    for (let i = 0; i < entry.delta; i++) list.push({ at: entry.createdAt, id: entry.id, price });
    turfs.set(entry.itemId, list);
  }

  const result = new Map<string, number[]>();
  for (const [itemId, list] of turfs) {
    // Clamped at zero, as the counts always were.
    const keep = Math.max(0, net.get(itemId) ?? 0);
    if (keep === 0) continue;
    list.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    result.set(itemId, list.slice(0, keep).map((turf) => turf.price));
  }
  return result;
}

/**
 * Every item one person consumed, with the money each line adds up to.
 *
 * One line per item per price. Three beers at 2.50 and one at 2.75 are two
 * lines, because a single line with one unit price would be wrong for one of
 * them, and an invoice has to show what was actually charged.
 */
export function personLines(event: AppEvent, personId: string): Line[] {
  const remaining = remainingPrices(event, personId);
  const lines: Line[] = [];
  for (const item of event.menu) {
    const prices = remaining.get(item.id);
    if (!prices) continue;
    const byPrice = new Map<number, number>();
    for (const price of prices) byPrice.set(price, (byPrice.get(price) ?? 0) + 1);
    for (const [unitCents, quantity] of byPrice) {
      lines.push({ item, quantity, unitCents, lineCents: quantity * unitCents });
    }
  }
  return lines;
}

export function personTotalCents(event: AppEvent, personId: string): number {
  const remaining = remainingPrices(event, personId);
  let total = 0;
  for (const item of event.menu) {
    for (const price of remaining.get(item.id) ?? []) total += price;
  }
  return total;
}

/**
 * What each item has cost one person so far: itemId -> cents.
 *
 * For a running amount beside an item, where splitting by price would be
 * clutter. The lines above are the place for that detail.
 */
export function itemCents(event: AppEvent, personId: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [itemId, prices] of remainingPrices(event, personId)) {
    result[itemId] = prices.reduce((sum, price) => sum + price, 0);
  }
  return result;
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

/**
 * Does this person pay at the end of the evening?
 *
 * Only a guest at an event does. Everyone on a tab, and every member at an
 * event, is invoiced by the treasurer instead -- so for them there is nothing
 * to collect tonight: no amount owing, no "paid" badge, no payment buttons.
 * Checked against the list as well as the person, so a row an older app added
 * to a tab with the default "tonight" is still treated as invoiced.
 */
export function paysTonight(event: AppEvent, person: Person): boolean {
  return event.kind === 'event' && person.billing === 'tonight';
}

/**
 * What one person still has to pay tonight. Never negative: overpaying is not
 * a debt. Zero for anyone on the invoice, whose total is the treasurer's to
 * collect, not the bar's.
 */
export function personOutstandingCents(event: AppEvent, person: Person): number {
  if (!paysTonight(event, person)) return 0;
  return Math.max(0, personTotalCents(event, person.id) - person.paidCents);
}

/**
 * Settled when nothing is left owing tonight, which changes again if they
 * order more. Never true for someone on the invoice: they have not paid, they
 * simply do not pay here.
 */
export function isSettled(event: AppEvent, person: Person): boolean {
  return paysTonight(event, person) && personOutstandingCents(event, person) === 0;
}

/** Money actually collected at the bar. */
export function eventPaidCents(event: AppEvent): number {
  return activePeople(event)
    .filter((person) => paysTonight(event, person))
    .reduce((sum, person) => sum + person.paidCents, 0);
}

/**
 * Money still to come in tonight.
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

/** What goes onto the treasurer's invoice rather than being paid at the bar. */
export function eventInvoiceCents(event: AppEvent): number {
  return activePeople(event)
    .filter((person) => !paysTonight(event, person))
    .reduce((sum, person) => sum + personTotalCents(event, person.id), 0);
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
