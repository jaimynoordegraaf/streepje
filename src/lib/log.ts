/**
 * De regels van het logboek, los van het scherm.
 *
 * Het logboekscherm en de Excel-export lezen hier allebei uit, zodat wat je op
 * het scherm ziet en wat in het bestand staat niet uit elkaar kunnen lopen. Er
 * staat bewust niets van Expo of React in: de rekenkant is zo in gewone Node
 * te testen.
 */

import { deviceLabel, rounds, type LocalDevice } from './totals';
import type { AppEvent } from './types';

/** Een regel zoals het scherm hem toont: een rondje is één regel. */
export type LogRow =
  | { id: string; at: number; kind: 'turf'; personId: string; person: string; item: string; delta: number; device: string | null }
  | { id: string; at: number; kind: 'payment'; personId: string; person: string; cents: number }
  | {
      id: string;
      at: number;
      kind: 'round';
      /** De gever: de regels staan op zijn rekening. */
      personId: string;
      /** "Rondje van Anne" */
      person: string;
      giver: string;
      what: string;
      /** Namen van wie een drankje kreeg. */
      names: string;
      recipientIds: string[];
      device: string | null;
    }
  | { id: string; at: number; kind: 'removed'; personId: string; person: string; device: string | null };

/**
 * Hoort deze regel bij deze persoon?
 *
 * Een rondje telt voor de gever én voor wie een drankje kreeg: bij beiden komt
 * het in het verhaal van die avond voor, en bij beiden kijkt de penningmeester
 * er terug.
 */
export function logInvolves(row: LogRow, personId: string): boolean {
  if (row.personId === personId) return true;
  return row.kind === 'round' && row.recipientIds.includes(personId);
}

/** Wat een persoon in het logboek heeft staan, voor de samenvatting boven het filter. */
export function logSummary(rows: LogRow[], personId: string) {
  let turfs = 0;
  let corrections = 0;
  let gave = 0;
  let received = 0;
  for (const row of rows) {
    if (!logInvolves(row, personId)) continue;
    if (row.kind === 'turf') {
      if (row.delta < 0) corrections += 1;
      else turfs += 1;
    } else if (row.kind === 'round') {
      if (row.personId === personId) gave += 1;
      else received += 1;
    }
  }
  return { turfs, corrections, gave, received };
}

const nameFinder = (event: AppEvent) => (personId: string) =>
  event.people.find((person) => person.id === personId)?.name ?? 'Onbekend';
const itemFinder = (event: AppEvent) => (itemId: string) =>
  event.menu.find((item) => item.id === itemId)?.name ?? 'Onbekend item';

/** De regels voor het scherm, nieuwste eerst. */
export function buildLogRows(event: AppEvent): LogRow[] {
  const nameOf = nameFinder(event);
  const itemOf = itemFinder(event);

  // Een rondje is in de opslag één regel per drankje. Hier wordt het één
  // regel: zes regels op dezelfde minuut verdrinken de rest van de avond.
  const out: LogRow[] = event.entries
    .filter((entry) => !entry.roundId)
    .map((entry) => ({
      id: entry.id,
      at: entry.createdAt,
      kind: 'turf' as const,
      personId: entry.personId,
      person: nameOf(entry.personId),
      item: itemOf(entry.itemId),
      delta: entry.delta,
      device: entry.deviceName,
    }));

  for (const round of rounds(event)) {
    out.push({
      id: `round-${round.id}`,
      at: round.at,
      kind: 'round',
      personId: round.giverId,
      person: `Rondje van ${nameOf(round.giverId)}`,
      giver: nameOf(round.giverId),
      what: round.items.map((line) => `${line.quantity}× ${itemOf(line.itemId)}`).join(', '),
      names: round.recipientIds.map(nameOf).join(', '),
      recipientIds: round.recipientIds,
      device: round.deviceName,
    });
  }

  for (const person of event.people) {
    if (person.paidAt && person.paidCents > 0) {
      out.push({
        id: `paid-${person.id}`,
        at: person.paidAt,
        kind: 'payment',
        personId: person.id,
        person: person.name,
        cents: person.paidCents,
      });
    }
    if (person.removedAt) {
      out.push({
        id: `removed-${person.id}`,
        at: person.removedAt,
        kind: 'removed',
        personId: person.id,
        person: person.name,
        device: person.removedBy,
      });
    }
  }

  return out.sort((a, b) => b.at - a.at);
}

export type LogLineKind = 'Turf' | 'Correctie' | 'Rondje' | 'Betaling' | 'Verwijderd';

/**
 * Eén regel van het bestand. Getallen blijven getallen: `quantity` en de
 * bedragen zijn null waar er niets te tellen valt, niet een lege tekst.
 */
export type LogLine = {
  at: number;
  person: string;
  kind: LogLineKind;
  item: string | null;
  /** Bij een rondje: wie het drankje kreeg. */
  forWho: string | null;
  /** Negatief bij een correctie. */
  quantity: number | null;
  unitCents: number | null;
  /** Aantal × stuksprijs, met hetzelfde teken als het aantal. */
  cents: number | null;
  /** Wat iemand heeft betaald. Staat apart zodat een som over Bedrag klopt. */
  paidCents: number | null;
  /** Rondjenummer, oudste eerst, om de drankjes van één rondje te herkennen. */
  round: number | null;
  device: string | null;
};

/**
 * Het hele logboek als platte regels, oudste eerst, voor de export.
 *
 * Anders dan op het scherm is een rondje hier niet één regel maar één per
 * drankje: in Excel moet elke regel één aantal en één bedrag hebben, anders
 * valt er niet op te filteren of te tellen. `round` houdt ze bij elkaar.
 * Een regel met aantal 3 (drie keer hetzelfde in één tik) blijft één regel met
 * aantal 3.
 */
export function buildLogLines(event: AppEvent, local?: LocalDevice): LogLine[] {
  const nameOf = nameFinder(event);
  const itemOf = itemFinder(event);
  const menuPrice = new Map(event.menu.map((item) => [item.id, item.priceCents]));

  const roundNumber = new Map<string, number>();
  rounds(event).forEach((round, index) => roundNumber.set(round.id, index + 1));

  const lines: LogLine[] = event.entries.map((entry) => {
    // De prijs van het moment, zoals de rekening hem ook gebruikt.
    const unit = entry.priceCents ?? menuPrice.get(entry.itemId) ?? 0;
    const inRound = Boolean(entry.roundId) && entry.delta > 0;
    return {
      at: entry.createdAt,
      person: nameOf(entry.personId),
      kind: entry.delta < 0 ? 'Correctie' : inRound ? 'Rondje' : 'Turf',
      item: itemOf(entry.itemId),
      forWho: entry.roundId ? nameOf(entry.forPersonId ?? entry.personId) : null,
      quantity: entry.delta,
      unitCents: unit,
      cents: entry.delta * unit,
      paidCents: null,
      round: entry.roundId ? (roundNumber.get(entry.roundId) ?? null) : null,
      device: deviceLabel(entry, local),
    };
  });

  for (const person of event.people) {
    if (person.paidAt && person.paidCents > 0) {
      lines.push({
        at: person.paidAt,
        person: person.name,
        kind: 'Betaling',
        item: null,
        forWho: null,
        quantity: null,
        unitCents: null,
        cents: null,
        paidCents: person.paidCents,
        round: null,
        device: null,
      });
    }
    if (person.removedAt) {
      lines.push({
        at: person.removedAt,
        person: person.name,
        kind: 'Verwijderd',
        item: null,
        forWho: null,
        quantity: null,
        unitCents: null,
        cents: null,
        paidCents: null,
        round: null,
        device: person.removedBy,
      });
    }
  }

  // Array.sort is stabiel, dus regels op dezelfde milliseconde houden hun volgorde.
  return lines.sort((a, b) => a.at - b.at);
}
