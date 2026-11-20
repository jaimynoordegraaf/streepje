/**
 * Hoe het delen er voor staat, in één regel: voor de lijst, Beheer en Delen.
 *
 * De bar-iPad heeft meestal geen internet. Er is daar geen wifi, hij heeft geen
 * simkaart, en de 4G-router staat alleen af en toe aan. Voor die iPad is offline
 * de gewone toestand, en is delen vooral een kopie op de server voor als de iPad
 * kwijtraakt of kapotgaat. Een rood puntje bij elke keer offline zou daar dus
 * altijd branden, en een waarschuwing die altijd brandt ziet niemand meer.
 *
 * Daarom is offline met wachtende turven gewoon een regel tekst, met erbij
 * wanneer de server voor het laatst bereikt is. Pas als er iets wacht én de
 * server al STIL_DAGEN niet bereikt is, gaat het puntje aan: dan is het tijd om
 * de router aan te zetten.
 *
 * Bewust zonder Expo of React, zodat dit in gewone Node te proberen is.
 */

import type { SyncStatus } from './use-sync';

/** Zo lang mag er iets wachten zonder dat de app erover begint. */
export const STIL_DAGEN = 14;

const MINUUT = 60 * 1000;
const DAG = 24 * 60 * MINUUT;

export type ShareLine = {
  /** De regel zelf, bijvoorbeeld "Offline · 12 nog te versturen · laatst verbonden gisteren". */
  label: string;
  /** Of het puntje aan moet: er wacht iets en de server is te lang niet bereikt. */
  alert: boolean;
  /** "3 dagen geleden", of null als deze telefoon de server nog nooit bereikte. */
  lastContact: string | null;
};

/** "zojuist", "5 min geleden", "3 uur geleden", "gisteren", "12 dagen geleden". */
export function timeAgo(then: number, now: number): string {
  const minutes = Math.floor((now - then) / MINUUT);
  if (minutes < 1) return 'zojuist';
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'gisteren';
  return `${days} dagen geleden`;
}

export function shareLine(input: {
  shared: boolean;
  /**
   * Hoe de verbinding er nu voor staat. Leeg waar het scherm die niet bijhoudt,
   * zoals Beheer: dan zegt de regel alleen wat er op de telefoon staat.
   */
  status?: SyncStatus;
  /** Turven die nog niet op de server staan. */
  pending: number;
  /** Een wijziging aan namen, prijzen of betalingen die nog niet is verstuurd. */
  unsaved: boolean;
  /** Wanneer deze telefoon de server voor het laatst bereikte. */
  lastSyncedAt: number | null;
  now: number;
}): ShareLine {
  const { shared, status, pending, unsaved, lastSyncedAt, now } = input;
  if (!shared) return { label: 'Alleen op deze telefoon', alert: false, lastContact: null };

  const waiting = pending > 0 || unsaved;
  // Nooit bereikt telt als te lang: dan staat er van deze lijst niets op de server.
  const quiet = lastSyncedAt === null || now - lastSyncedAt > STIL_DAGEN * DAG;
  const alert = waiting && quiet;
  const lastContact = lastSyncedAt === null ? null : timeAgo(lastSyncedAt, now);

  const what =
    pending > 0
      ? `${pending} nog te versturen`
      : unsaved
        ? 'een wijziging nog te versturen'
        : 'niets te versturen';
  const since = lastContact ? ` · laatst verbonden ${lastContact}` : ' · nog nooit verbonden';

  if (status === 'connecting') return { label: 'Verbinden…', alert, lastContact };
  if (status === 'gone') return { label: 'Niet meer op de server', alert: false, lastContact };
  if (status === 'live') {
    return {
      label: waiting ? `Verbonden · ${what}` : 'Verbonden · alles staat op de server',
      alert: false,
      lastContact,
    };
  }
  if (status === 'offline') return { label: `Offline · ${what}${since}`, alert, lastContact };

  // Geen verbinding bijgehouden (Beheer), of nog niet begonnen.
  return { label: waiting ? `Gedeeld · ${what}${since}` : 'Gedeeld', alert, lastContact };
}
