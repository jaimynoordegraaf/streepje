/**
 * The correction PIN.
 *
 * Adding a turf is deliberately frictionless -- you are standing at a bar with
 * people waiting. Removing one is not, because a removal takes money off
 * someone's tab and is exactly what a dishonest or careless tap would do.
 *
 * Two things must both hold before a turf can be removed:
 *   1. you are on the phone that owns the event (see `isHostDevice`), and
 *   2. you know the event's correction PIN.
 *
 * The PIN is never stored as typed. It is salted and hashed, so reading the
 * phone's stored data does not hand someone the code. It also never leaves the
 * device: a shared event syncs orders and people, not the PIN.
 *
 * Be clear about what this does and does not do. It stops casual tampering and
 * accidental taps. It does not stop whoever holds the host phone and knows the
 * PIN -- that person is trusted by definition, which is why every correction is
 * also recorded and shown (see the totals screen and the CSV export).
 */

import * as Crypto from 'expo-crypto';

import type { AppEvent, PinRecord } from './types';

export type { PinRecord };

export const PIN_LENGTH = 4;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hash(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

/** Turn a freshly chosen PIN into something safe to store. */
export async function createPinRecord(pin: string): Promise<PinRecord> {
  const salt = toHex(Crypto.getRandomBytes(16));
  return { salt, hash: await hash(pin, salt) };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  return (await hash(pin, record.salt)) === record.hash;
}

export function isValidPinFormat(pin: string): boolean {
  // Written as a plain regex literal on purpose. This was once built with
  // new RegExp() from a template string, where the digit escape lost its
  // backslash and quietly turned into the letter d -- so the check rejected
  // every valid PIN and no code could be set at all.
  return pin.length === PIN_LENGTH && /^[0-9]+$/.test(pin);
}

/**
 * Is this the phone that owns the event?
 *
 * An event that was never shared lives only here, so this phone owns it. A
 * shared one is owned by whoever created it; phones that joined are guests.
 */
export function isHostDevice(event: AppEvent): boolean {
  return event.share === null || event.share.role === 'host';
}

export type CorrectionBlock =
  | { allowed: true }
  | { allowed: false; reason: 'guest' | 'no-pin' };

/**
 * Why a correction cannot be made right now, if it cannot.
 *
 * `no-pin` is not a refusal so much as a prompt: the host has not chosen a PIN
 * yet, and is asked to set one at that moment rather than being sent away.
 */
export function correctionBlock(event: AppEvent): CorrectionBlock {
  if (!isHostDevice(event)) return { allowed: false, reason: 'guest' };
  if (!event.correctionPin) return { allowed: false, reason: 'no-pin' };
  return { allowed: true };
}

/**
 * Slow down guessing.
 *
 * Four digits is only ten thousand combinations, and a person with the phone
 * could work through a useful fraction of them by hand. After three wrong
 * tries the PIN stops being accepted for a while, which turns a few minutes of
 * guessing into hours. Held in memory only: it is a speed bump, not a vault,
 * and it resets when the app restarts.
 */
const failures = new Map<string, { count: number; until: number }>();

const LOCK_AFTER = 3;
const LOCK_SECONDS = 30;

export function noteWrongPin(eventId: string): void {
  const current = failures.get(eventId) ?? { count: 0, until: 0 };
  const count = current.count + 1;
  failures.set(eventId, {
    count,
    // Each further failure past the threshold waits longer than the last.
    until: count >= LOCK_AFTER ? Date.now() + LOCK_SECONDS * 1000 * (count - LOCK_AFTER + 1) : 0,
  });
}

export function clearWrongPins(eventId: string): void {
  failures.delete(eventId);
}

/** Seconds still to wait, or 0 when a PIN may be tried. */
export function lockedForSeconds(eventId: string): number {
  const current = failures.get(eventId);
  if (!current || current.until <= Date.now()) return 0;
  return Math.ceil((current.until - Date.now()) / 1000);
}

/**
 * A short unlocked window after a correct PIN.
 *
 * Fixing one real mistake is usually several taps -- three beers put on the
 * wrong person is three removals. Asking for the PIN each time would push
 * people towards leaving errors in rather than correcting them, which is worse
 * for the totals than the friction is worth. Verification still happened; this
 * only decides how long it counts for.
 *
 * Deliberately short, in memory only, and dropped when the screen is left.
 */
const unlocked = new Map<string, number>();

export const UNLOCK_SECONDS = 120;

export function unlockCorrections(eventId: string): void {
  unlocked.set(eventId, Date.now() + UNLOCK_SECONDS * 1000);
}

export function lockCorrections(eventId: string): void {
  unlocked.delete(eventId);
}

export function correctionsUnlocked(eventId: string): boolean {
  const until = unlocked.get(eventId);
  if (!until) return false;
  if (until <= Date.now()) {
    unlocked.delete(eventId);
    return false;
  }
  return true;
}
