/**
 * De kolommen van de penningmeester.
 *
 * De kwartaalfactuur wordt al jaren in een spreadsheet bijgehouden, met per
 * streeplijst één blok en daarin een vaste set kolommen, geteld per lid. De app
 * verzint daarom geen eigen indeling: elk menu-item wijst naar één van deze
 * kolommen, en de export vult precies die kolommen.
 *
 * Overig is de vreemde eend: dat is geld, geen aantal. Een BBQ of het eten op
 * een evenement loopt via dezelfde afrekening, en daar zet de penningmeester
 * een bedrag neer in plaats van een aantal stuks.
 */

import type { LedgerCategory } from './types';

export const LEDGER: { value: LedgerCategory; label: string; money?: boolean }[] = [
  { value: 'bier', label: 'Bier B' },
  { value: 'bier-speciaal', label: 'Bier SB/Wijn' },
  { value: 'fris', label: 'Fris' },
  { value: 'energie', label: 'Energie' },
  { value: 'chips', label: 'Chips' },
  { value: 'snoep', label: 'Snoep' },
  { value: 'overig', label: 'Overig', money: true },
];

export const ledgerLabel = (value: LedgerCategory): string =>
  LEDGER.find((entry) => entry.value === value)?.label ?? 'Overig';

/**
 * Een eerste gok op basis van de naam, voor menu's die al bestonden.
 *
 * Bedoeld om werk te schelen, niet om slim te zijn: de beheerder ziet de
 * categorie bij elk item staan en zet hem recht waar de gok ernaast zit. De
 * volgorde telt -- speciaalbier moet vóór bier komen, en energie vóór fris.
 */
export function guessLedger(name: string): LedgerCategory {
  const text = name.toLowerCase();
  if (/speciaal|wijn|tripel|dubbel|ipa|bok|karmaliet|weizen/.test(text)) return 'bier-speciaal';
  if (/bier|pils/.test(text)) return 'bier';
  if (/energ|red ?bull|monster/.test(text)) return 'energie';
  if (/fris|cola|sinas|fanta|water|thee|koffie|sap|ranja|limonade/.test(text)) return 'fris';
  if (/chips|nootje|noten|zoutje|borrelnoot/.test(text)) return 'chips';
  if (/snoep|drop|reep|mars|snicker|candy|zuurtje/.test(text)) return 'snoep';
  return 'overig';
}
