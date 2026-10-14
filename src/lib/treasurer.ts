/**
 * Het blok dat de penningmeester in zijn kwartaalsheet plakt.
 *
 * Die sheet is ouder dan deze app en heeft een vaste indeling: per streeplijst
 * één blok, met per lid een rij en vaste kolommen. De app verzint daar niets
 * bij, hij vult precies die kolommen.
 *
 * Twee dingen die bij het narekenen tellen:
 *  - de zes gewone kolommen zijn *aantallen*; de sheet rekent zelf met eigen
 *    stuksprijzen, die niet dezelfde hoeven te zijn als die van de bar;
 *  - Overig is *geld*. Een BBQ of het eten op een evenement loopt via dezelfde
 *    afrekening, en daar hoort een bedrag, geen aantal.
 *
 * Los van export.ts gehouden, want dat bestand praat met het bestandssysteem
 * en de deelknop van het toestel. Zo blijft dit in gewone Node te testen.
 */

import { csvRow, formatDate, formatDateTime } from './csv';
import { LEDGER } from './ledger';
import { centsToPlainNumber } from './money';
import { activePeople, paysTonight } from './totals';
import type { AppEvent } from './types';

export type Period = { label: string; from: number; to: number; quarter: number };

const startOfQuarter = (year: number, quarter: number) =>
  new Date(year, (quarter - 1) * 3, 1).getTime();
const endOfQuarter = (year: number, quarter: number) =>
  new Date(year, quarter * 3, 1).getTime() - 1;

/** De kwartalen waarin in deze lijst daadwerkelijk is geturfd, nieuwste eerst. */
export function periodsInEvent(event: AppEvent): Period[] {
  const seen = new Map<string, Period>();
  for (const entry of event.entries) {
    const date = new Date(entry.createdAt);
    const year = date.getFullYear();
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    const key = `${year}-${quarter}`;
    if (!seen.has(key)) {
      seen.set(key, {
        label: `${year} Q${quarter}`,
        from: startOfQuarter(year, quarter),
        to: endOfQuarter(year, quarter),
        quarter,
      });
    }
  }
  return [...seen.values()].sort((a, b) => b.from - a.from);
}

/** De hele lijst als één periode, voor een evenement van één avond. */
export function wholeEventPeriod(event: AppEvent): Period {
  const times = event.entries.map((entry) => entry.createdAt);
  const from = times.length > 0 ? Math.min(...times) : event.createdAt;
  const to = times.length > 0 ? Math.max(...times) : Date.now();
  return {
    label: 'Hele lijst',
    from,
    to,
    quarter: Math.floor(new Date(from).getMonth() / 3) + 1,
  };
}

export function buildTreasurerCsv(event: AppEvent, period: Period): string {
  const rows: string[] = [];
  const columns = LEDGER.filter((entry) => !entry.money);

  const itemById = new Map(event.menu.map((item) => [item.id, item]));
  // Alleen wie op factuur gaat. Gasten die dezelfde avond afrekenen horen niet
  // op een kwartaalfactuur thuis.
  const people = activePeople(event).filter((person) => !paysTonight(event, person));

  rows.push(csvRow(['Lijst', event.name]));
  rows.push(csvRow(['Van', formatDate(period.from)]));
  rows.push(csvRow(['Tot', formatDate(period.to)]));
  rows.push(csvRow(['Periode', period.quarter]));
  rows.push(csvRow(['Geëxporteerd', formatDateTime(Date.now())]));
  rows.push('');

  rows.push(
    csvRow(['Naam', 'Toevoeging', ...columns.map((column) => column.label), 'Overig', 'Totaal'])
  );

  /**
   * De tweede kolom: waar iemand bij hoort.
   *
   * Voor een gast van buiten is dat meestal de eigen scoutinggroep. Turft
   * iemand mee op een ander, dan hoort dát er ook in, want de penningmeester
   * ziet anders een naam die hij nergens kan plaatsen. Allebei kan.
   */
  const addition = (person: (typeof people)[number]): string => {
    const host = person.guestOf
      ? event.people.find((candidate) => candidate.id === person.guestOf)?.name
      : undefined;
    return [person.note, host ? `gast van ${host}` : null].filter(Boolean).join(' · ');
  };

  const totals = new Map<string, number>();
  let totalOverigCents = 0;
  let totalCents = 0;

  for (const person of people) {
    const counts = new Map<string, number>();
    let overigCents = 0;
    let personCents = 0;

    for (const entry of event.entries) {
      if (entry.personId !== person.id) continue;
      if (entry.createdAt < period.from || entry.createdAt > period.to) continue;

      const item = itemById.get(entry.itemId);
      const ledger = item?.ledger ?? 'overig';
      // De prijs van het moment van turven, net als overal elders: een latere
      // prijswijziging mag een afgerekend kwartaal niet verschuiven.
      const cents = entry.delta * (entry.priceCents ?? item?.priceCents ?? 0);
      personCents += cents;

      if (ledger === 'overig') overigCents += cents;
      else counts.set(ledger, (counts.get(ledger) ?? 0) + entry.delta);
    }

    for (const column of columns) {
      totals.set(column.value, (totals.get(column.value) ?? 0) + (counts.get(column.value) ?? 0));
    }
    totalOverigCents += overigCents;
    totalCents += personCents;

    // Ook wie in deze periode niets had krijgt een regel: de penningmeester
    // plakt het blok naast een vaste namenlijst, en een ontbrekende regel laat
    // alles eronder verschuiven.
    rows.push(
      csvRow([
        person.name,
        addition(person),
        ...columns.map((column) => counts.get(column.value) ?? 0),
        centsToPlainNumber(overigCents),
        centsToPlainNumber(personCents),
      ])
    );
  }

  rows.push('');
  rows.push(
    csvRow([
      'Totaal',
      '',
      ...columns.map((column) => totals.get(column.value) ?? 0),
      centsToPlainNumber(totalOverigCents),
      centsToPlainNumber(totalCents),
    ])
  );

  // Items zonder kolom vallen onder Overig. Dat is een keuze, geen fout, maar
  // de beheerder moet het weten: meestal is er gewoon een nieuw drankje
  // toegevoegd waar nog geen kolom bij staat.
  const unlabelled = event.menu.filter((item) => !item.hidden && !item.ledger);
  if (unlabelled.length > 0) {
    rows.push('');
    rows.push(csvRow(['Let op: deze items tellen als Overig omdat ze geen kolom hebben']));
    for (const item of unlabelled) rows.push(csvRow([item.name]));
  }

  return rows.join('\n');
}
