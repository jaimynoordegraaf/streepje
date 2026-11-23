/**
 * Wat de barploeg-groep met de lijsten op deze telefoon doet, op één plek.
 *
 * De groep is de basis van streepje: een toestel doet één keer mee met de
 * groepscode, en alle lijsten horen daarbij. Het beginscherm, Alle lijsten en
 * het Groep-scherm hebben daarvoor hetzelfde nodig: lijsten van de groep
 * ophalen, en een lijst van dit toestel in de groep zetten. Samen in een hook,
 * zodat alle schermen hetzelfde doen in plaats van kopieën die uit elkaar lopen.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { newJoinCode, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  attachToGroup,
  fetchGroupSessions,
  fetchSession,
  hostSession,
  joinSession,
  setGroupMemberName,
  setMemberName,
  type GroupSession,
} from '@/lib/sync';

/**
 * Een lijst van de groep op dit toestel zetten.
 *
 * Ook echt deelnemen aan de lijst, niet alleen meekijken via de groep. Anders
 * staat dit toestel nergens in de lijst met telefoons, en kan een beheerder hem
 * dus ook geen beheerder van die lijst maken.
 */
export async function fetchIntoDevice(listing: GroupSession): Promise<void> {
  const { adoptRemoteEvent, deviceName } = useStore.getState();
  const remote = await fetchSession(listing.id);
  await joinSession(listing.joinCode).catch(() => {});
  if (deviceName) await setMemberName(listing.id, deviceName).catch(() => {});
  adoptRemoteEvent({
    id: listing.id,
    name: remote.name,
    kind: remote.kind,
    createdAt: remote.createdAt,
    people: remote.people,
    menu: remote.menu,
    entries: remote.entries,
    unsyncedEntryIds: [],
    closed: remote.closed,
    groupId: remote.groupId,
    // De rol wordt bij de eerste synchronisatie door de server bevestigd.
    share: { joinCode: listing.joinCode, role: 'member', lastSyncedAt: Date.now() },
    correctionPin: null,
  });
}

/**
 * Een lijst van dit toestel in de groep zetten.
 *
 * Twee gevallen, en het verschil telt:
 *
 * - De lijst staat nog niet op de server. Dan wordt hij er nieuw op gezet, met
 *   alles erin, en daarna bij de groep. Er staat niets om over te schrijven.
 * - De lijst staat er al, omdat hij vroeger met een losse code is gedeeld. Dan
 *   wordt alleen de groep erbij gezet en verder NIETS verstuurd. Een toestel dat
 *   lang niet open was, zou anders met zijn oude stand een betaling van een
 *   ander ongedaan kunnen maken (zie het databaserapport, punt 2). Turven die
 *   hier nog wachten gaan zoals altijd vanzelf, die worden alleen toegevoegd.
 *
 * Lukt het niet, bijvoorbeeld omdat de bar-iPad geen verbinding heeft, dan
 * krijgt de lijst de vlag `groupPending` en probeert `syncGroup` het opnieuw
 * zodra er verbinding is. De fout gaat door naar wie erom vroeg.
 */
export async function putIntoGroup(eventId: string): Promise<void> {
  const state = useStore.getState();
  const group = state.group;
  const event = state.events.find((candidate) => candidate.id === eventId);
  // De voorbeeldlijst van de rondleiding gaat nooit naar de server (zie types.ts).
  if (!group || !isSyncConfigured || !event || event.groupId || event.demo) return;

  try {
    if (!event.share) {
      const { joinCode, refusedEntryIds } = await hostSession(event, newJoinCode());
      state.dropEntries(eventId, refusedEntryIds);
      state.setShare(eventId, { joinCode, role: 'admin', lastSyncedAt: Date.now() });
      if (state.deviceName) await setMemberName(eventId, state.deviceName).catch(() => {});
    }
    await attachToGroup(eventId, group.id);
    state.setEventGroup(eventId, group.id);
  } catch (error) {
    useStore.getState().setGroupPending(eventId, true);
    throw error;
  }
}

export function useGroupSync(syncOnFocus = false) {
  const group = useStore((state) => state.group);
  const [fetching, setFetching] = useState(false);

  /**
   * Lijsten van de groep ophalen die nog niet op deze telefoon staan.
   *
   * Dit is waar een groep voor is: wie meedoet hoeft niets te scannen als er
   * een nieuwe avond wordt aangemaakt. Alleen de open lijsten en de lopende
   * rekening komen vanzelf. Een afgesloten avond haal je op het Groep-scherm
   * op als je hem nodig hebt; anders haalt een nieuw toestel elke oude avond
   * van het hele jaar binnen.
   *
   * Ook: lijsten die hier offline zijn gemaakt alsnog de groep in zetten, en
   * de naam van dit toestel in de groep zetten, zodat de anderen zien wie er
   * meedoet. Stil als er geen verbinding is: dan staat er gewoon wat er al stond.
   */
  const syncGroup = useCallback(async () => {
    if (!group || !isSyncConfigured) return;
    setFetching(true);
    try {
      const { events, deviceName } = useStore.getState();
      if (deviceName) await setGroupMemberName(group.id, deviceName).catch(() => {});

      for (const event of events) {
        if (event.groupPending && !event.groupId && !event.demo) {
          await putIntoGroup(event.id).catch(() => {});
        }
      }

      const known = new Set(useStore.getState().events.map((event) => event.id));
      for (const listing of await fetchGroupSessions(group.id)) {
        if (known.has(listing.id) || listing.closed) continue;
        await fetchIntoDevice(listing);
      }
    } catch {
      // Geen bereik of de server is er even niet. Niets aan de hand: de lijsten
      // die al op deze telefoon staan werken gewoon door.
    } finally {
      setFetching(false);
    }
  }, [group]);

  /** Optioneel: haal de lijsten van de groep op zodra het scherm in beeld komt. */
  useFocusEffect(
    useCallback(() => {
      if (syncOnFocus) syncGroup();
    }, [syncGroup, syncOnFocus])
  );

  /**
   * Een nieuwe lijst hoort meteen bij de groep.
   *
   * Op de achtergrond en zonder melding: op de bar-iPad is geen verbinding de
   * gewone toestand, en dan gaat de lijst vanzelf de groep in zodra die er wel
   * is. Het Groep-scherm laat zien dat hij nog wacht.
   */
  const shareIntoGroup = useCallback(async (eventId: string) => {
    await putIntoGroup(eventId).catch(() => {});
  }, []);

  return { group, fetching, syncGroup, shareIntoGroup };
}
