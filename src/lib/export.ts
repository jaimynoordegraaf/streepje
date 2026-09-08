/**
 * Turning an event into something you can check outside the app.
 *
 * Two shapes are offered:
 *  - a CSV file, for opening in Excel / Numbers / Google Sheets;
 *  - a short text summary, for pasting into WhatsApp or a message.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { centsToPlainNumber, formatCents } from './money';
import { useStore } from './store';
import {
  correctionCount,
  corrections,
  deviceLabel,
  type LocalDevice,
  eventOutstandingCents,
  eventPaidCents,
  eventTotalCents,
  personItemCount,
  personLines,
  personTotalCents,
} from './totals';
import type { AppEvent } from './types';

/**
 * Excel on some systems (notably Dutch/German Windows) expects a semicolon
 * instead of a comma. If your export lands entirely in column A, change this
 * to ';' and re-export.
 */
const DELIMITER = ',';

/** Wrap a value in quotes when it contains something that would break the CSV. */
function csvCell(value: string | number): string {
  const text = String(value);
  if (text.includes(DELIMITER) || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(DELIMITER);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local date as yyyy-mm-dd (not UTC, so it matches the phone's calendar). */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatDate(timestamp)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildCsv(event: AppEvent, local?: LocalDevice): string {
  const rows: string[] = [];

  rows.push(csvRow(['Evenement', event.name]));
  rows.push(csvRow(['Datum', formatDate(event.createdAt)]));
  rows.push(csvRow(['Geëxporteerd', formatDateTime(Date.now())]));
  rows.push('');

  rows.push(csvRow(['DETAILS']));
  rows.push(csvRow(['Persoon', 'Item', 'Categorie', 'Aantal', 'Stukprijs', 'Regeltotaal']));
  for (const person of event.people) {
    const lines = personLines(event, person.id);
    if (lines.length === 0) {
      rows.push(csvRow([person.name, '(niets geturfd)', '', 0, '', '0.00']));
      continue;
    }
    for (const line of lines) {
      rows.push(
        csvRow([
          person.name,
          line.item.name,
          line.item.category === 'drink' ? 'drankje' : 'eten',
          line.quantity,
          centsToPlainNumber(line.item.priceCents),
          centsToPlainNumber(line.lineCents),
        ])
      );
    }
  }
  rows.push('');

  rows.push(csvRow(['OVERZICHT']));
  rows.push(csvRow(['Persoon', 'Consumpties', 'Totaal', 'Betaald', 'Betaald op']));
  for (const person of event.people) {
    rows.push(
      csvRow([
        person.name,
        personItemCount(event, person.id),
        centsToPlainNumber(personTotalCents(event, person.id)),
        person.paid ? 'ja' : 'nee',
        person.paidAt ? formatDateTime(person.paidAt) : '',
      ])
    );
  }
  rows.push('');

  rows.push(csvRow(['Eindtotaal', '', centsToPlainNumber(eventTotalCents(event))]));
  rows.push(csvRow(['Ontvangen', '', centsToPlainNumber(eventPaidCents(event))]));
  rows.push(csvRow(['Openstaand', '', centsToPlainNumber(eventOutstandingCents(event))]));

  // Every removal, so the paper record shows what was taken off and when.
  // Without this the CSV shows only the net result, and a turf that was
  // removed would be indistinguishable from one never logged at all.
  const removed = corrections(event);
  if (removed.length > 0) {
    const personName = (personId: string) =>
      event.people.find((person) => person.id === personId)?.name ?? 'onbekend';
    const itemName = (itemId: string) =>
      event.menu.find((item) => item.id === itemId)?.name ?? 'onbekend';

    rows.push('');
    rows.push(csvRow(['CORRECTIES']));
    rows.push(csvRow(['Tijd', 'Persoon', 'Item', 'Aantal weggehaald', 'Telefoon']));
    for (const entry of removed) {
      rows.push(
        csvRow([
          formatDateTime(entry.createdAt),
          personName(entry.personId),
          itemName(entry.itemId),
          -entry.delta,
          deviceLabel(entry, local),
        ])
      );
    }
  }

  return rows.join('\n');
}

export function buildSummaryText(event: AppEvent): string {
  const lines: string[] = [`${event.name} - ${formatDate(event.createdAt)}`, ''];

  for (const person of event.people) {
    const total = personTotalCents(event, person.id);
    const detail = personLines(event, person.id)
      .map((line) => `${line.quantity}x ${line.item.name}`)
      .join(', ');
    const status = person.paid ? ' (betaald)' : '';
    lines.push(`${person.name}: ${formatCents(total)}${status}`);
    if (detail) lines.push(`   ${detail}`);
  }

  lines.push('');
  lines.push(`Totaal: ${formatCents(eventTotalCents(event))}`);
  lines.push(`Openstaand: ${formatCents(eventOutstandingCents(event))}`);

  const removedCount = correctionCount(event);
  if (removedCount > 0) {
    lines.push(`Weggehaald: ${removedCount} ${removedCount === 1 ? 'turfje' : 'turfjes'}`);
  }

  return lines.join('\n');
}

/** Make a safe filename out of the event name, e.g. "BBQ 12 Sept" -> "bbq-12-sept". */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'event'
  );
}

/**
 * Write the CSV to a temporary file and hand it to the Android share sheet, so
 * it can go to Drive, Gmail, WhatsApp, or anywhere else you pick.
 */
export async function exportCsv(event: AppEvent): Promise<void> {
  const local = { deviceId: useStore.getState().deviceId, deviceName: useStore.getState().deviceName };
  const filename = `streepje-${slugify(event.name)}-${formatDate(event.createdAt)}.csv`;
  const file = new File(Paths.cache, filename);

  if (file.exists) file.delete();
  file.create();
  // The leading \uFEFF is a byte-order mark; it tells Excel the file is UTF-8
  // so accented names do not come out garbled.
  file.write(`\uFEFF${buildCsv(event)}`);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Delen is niet beschikbaar op dit apparaat.');
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: `Exporteren: ${event.name}`,
    UTI: 'public.comma-separated-values-text',
  });
}

/** Share the short readable version as plain text. */
export async function shareSummary(event: AppEvent): Promise<void> {
  await Share.share({ message: buildSummaryText(event) });
}
