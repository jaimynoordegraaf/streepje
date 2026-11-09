/**
 * Het logboek als Excel-bestand: de tabbladen, los van het wegschrijven en
 * delen (dat staat in export.ts). Zonder Expo, zodat het in Node te testen is.
 */

import { formatDateTime } from './csv';
import { buildLogLines, type LogLine } from './log';
import type { LocalDevice } from './totals';
import type { AppEvent } from './types';
import { buildXlsx, type CellValue, type Column, type Sheet } from './xlsx';

/** De kolommen van het tabblad Logboek, in deze volgorde. */
export const LOG_COLUMNS: Column[] = [
  { title: 'Datum', kind: 'date', width: 12 },
  { title: 'Tijd', kind: 'time', width: 8 },
  { title: 'Persoon', kind: 'text', width: 22 },
  { title: 'Soort', kind: 'text', width: 12 },
  { title: 'Item', kind: 'text', width: 20 },
  { title: 'Voor wie', kind: 'text', width: 22 },
  { title: 'Aantal', kind: 'integer', width: 9 },
  { title: 'Stuksprijs', kind: 'money', width: 12 },
  { title: 'Bedrag', kind: 'money', width: 12 },
  { title: 'Betaald', kind: 'money', width: 12 },
  { title: 'Rondje', kind: 'integer', width: 9 },
  { title: 'Toestel', kind: 'text', width: 22 },
];

export function logLineCells(line: LogLine): CellValue[] {
  return [
    line.at,
    line.at,
    line.person,
    line.kind,
    line.item,
    line.forWho,
    line.quantity,
    line.unitCents,
    line.cents,
    line.paidCents,
    line.round,
    line.device,
  ];
}

export function buildLogSheets(event: AppEvent, local?: LocalDevice, now = Date.now()): Sheet[] {
  const lines = buildLogLines(event, local);

  const info: [string, string][] = [
    ['Lijst', event.name],
    ['Geëxporteerd', formatDateTime(now)],
    ['Regels', String(lines.length)],
    ['', ''],
    ['Volgorde', 'Oudste regel bovenaan. Sorteren en filteren kan met de pijltjes in de kopregel.'],
    ['Aantal', 'Een correctie heeft een negatief aantal en een negatief bedrag, dus een som over de kolom Bedrag klopt met wat iemand moet betalen.'],
    ['Rondje', 'Elk drankje van een rondje staat op een eigen regel. Persoon is de gever (die betaalt), Voor wie de ontvanger. Het nummer in de kolom Rondje is voor alle drankjes van één rondje hetzelfde.'],
    ['Betaling', 'Staat in de kolom Betaald, niet in Bedrag. De app bewaart alleen de stand van nu: het bedrag en het laatste moment van betalen, geen geschiedenis.'],
    ['Verwijderd', 'Iemand die uit de lijst is gehaald. De regels van die persoon blijven staan.'],
  ];

  return [
    {
      name: 'Logboek',
      columns: LOG_COLUMNS,
      rows: lines.map(logLineCells),
    },
    {
      name: 'Info',
      columns: [
        { title: 'Wat', kind: 'text', width: 16 },
        { title: 'Waarde', kind: 'text', width: 90 },
      ],
      rows: info,
      filter: false,
    },
  ];
}

/** De .xlsx als bytes. */
export function buildLogXlsx(event: AppEvent, local?: LocalDevice, now = Date.now()): Uint8Array {
  return buildXlsx(buildLogSheets(event, local, now), new Date(now));
}
