/**
 * Gasten op een lopende rekening.
 *
 * Een gast daar hoort bij een lid: zijn streepjes tellen bij dat lid en gaan op
 * diens factuur. Hij is wel een eigen regel, zodat je ziet wie wat dronk, maar
 * op de factuur van de penningmeester is er één regel per lid.
 *
 * Alleen op een lopende rekening. Een gast op een evenement houdt zijn eigen
 * regel, zoals het was: daar rekent hij ook vanavond af als hij dat wil.
 */

import type { AppEvent, Person } from './types';

/** Is deze persoon een gast die bij een lid op de lijst staat? */
export function isGuestOfMember(event: AppEvent, person: Person, members: Person[]): boolean {
  return (
    event.kind === 'tab' &&
    person.guestOf !== null &&
    members.some((member) => member.id === person.guestOf && member.guestOf === null)
  );
}

/** De gasten van één lid, in de volgorde van de lijst. */
export function guestsOf(event: AppEvent, hostId: string, people: Person[]): Person[] {
  if (event.kind !== 'tab') return [];
  return people.filter((person) => person.guestOf === hostId);
}

/**
 * De namen met elke gast direct onder zijn lid. Wie niet bij een lid hoort, of
 * wiens lid er niet meer op staat, blijft op zijn eigen plek.
 */
export function guestsUnderHosts(event: AppEvent, people: Person[]): Person[] {
  if (event.kind !== 'tab') return people;
  const result: Person[] = [];
  for (const person of people) {
    if (isGuestOfMember(event, person, people)) continue;
    result.push(person);
    result.push(...guestsOf(event, person.id, people));
  }
  return result;
}
