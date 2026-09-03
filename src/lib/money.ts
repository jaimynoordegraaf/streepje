/**
 * Helpers for turning cents into text and back.
 * Change CURRENCY and the separators here if you want a different notation.
 */

const CURRENCY = '\u20AC'; // euro sign
const DECIMAL_SEPARATOR = ',';

/** 250 -> "€2,50" */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${CURRENCY}${whole}${DECIMAL_SEPARATOR}${fraction}`;
}

/** 250 -> "2.50". Used for the CSV export, where a plain number is wanted. */
export function centsToPlainNumber(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * Turn typed text into cents. Accepts "2,50", "2.50", "2", "€2,50".
 * Returns null when the text is not a usable price, so the caller can
 * show a validation message instead of storing NaN.
 */
export function parsePrice(input: string): number | null {
  const cleaned = input.trim().replace(/[\u20AC\s]/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '.') return null;
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** 250 -> "2,50", for pre-filling an edit field. */
export function centsToInput(cents: number): string {
  return centsToPlainNumber(cents).replace('.', DECIMAL_SEPARATOR);
}
