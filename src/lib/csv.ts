/**
 * De kleine bouwstenen van een CSV, los van alles wat met bestanden of delen
 * te maken heeft. Zo kan de rekenkant van een export in gewone Node getest
 * worden, zonder dat Expo erbij komt kijken.
 */

/**
 * Excel on some systems (notably Dutch/German Windows) expects a semicolon
 * instead of a comma. If your export lands entirely in column A, change this
 * to ';' and re-export.
 */
export const DELIMITER = ',';

/** Wrap a value in quotes when it contains something that would break the CSV. */
export function csvCell(value: string | number): string {
  const text = String(value);
  if (text.includes(DELIMITER) || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(cells: (string | number)[]): string {
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
