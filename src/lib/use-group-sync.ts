/**
 * Wat de barploeg-groep met de lijsten op deze telefoon doet, op één plek.
 *
 * Het beginscherm en het overzicht van alle lijsten hebben allebei hetzelfde
 * nodig: nieuwe lijsten van de groep ophalen, en een lijst die hier wordt
 * aangemaakt meteen bij de groep zetten. Samen in een hook, zodat beide
 * schermen hetzelfde doen in plaats van twee kopieën die uit elkaar lopen.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { describeError } from '@/lib/errors';
import { newJoinCode, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  attachToGroup,
  fetchGroupSessions,
  fetchSession,
  hostSession,
  joinSession,
  setMemberName,
} from '@/lib/sync';

export function useGroupSync(syncOnFocus = false) {
  const group = useStore((state) => state.group);
  const adoptRemoteEvent = useStore((state) => state.adoptRemoteEvent);
  const setShare = useStore((state) => state.setShare);
  const setEventGroup = useStore((state) => state.setEventGroup);
  const [fetching, setFetching] = useState(false);

  /**
   * Lijsten van de groep ophalen die nog niet op deze telefoon staan.
   *
   * Dit is waar een groep voor is: wie meedoet hoeft niets te scannen als er
   * een nieuwe avond wordt aangemaakt. Stil als er niets te halen valt, en
   * stil als er geen verbinding is -- dan staat er gewoon wat er al stond.
   */
  const syncGroup = useCallback(async () => {
    if (!group || !isSyncConfigured) return;
    setFetching(true);
    try {
      const known = new Set(useStore.getState().events.map((event) => event.id));
      const deviceName = useStore.getState().deviceName;
      for (const listing of await fetchGroupSessions(group.id)) {
        if (known.has(listing.id)) continue;
        const remote = await fetchSession(listing.id);

        // Ook echt deelnemen aan de lijst, niet alleen meekijken via de groep.
        // Anders staat deze telefoon nergens in de lijst met telefoons, en kan
        // een beheerder hem dus ook niet beheerder maken.
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
    } catch {
      // Geen bereik of de server is er even niet. Niets aan de hand: de lijsten
      // die al op deze telefoon staan werken gewoon door.
    } finally {
      setFetching(false);
    }
  }, [group, adoptRemoteEvent]);

  /** Optioneel: haal de lijsten van de groep op zodra het scherm in beeld komt. */
  useFocusEffect(
    useCallback(() => {
      if (syncOnFocus) syncGroup();
    }, [syncGroup, syncOnFocus])
  );

  /**
   * Een nieuwe lijst van iemand uit de barploeg hoort meteen bij de groep.
   *
   * Zonder dit zou elke avond opnieuw gedeeld en gescand moeten worden, en dat
   * is precies waar de groep een eind aan maakt. Lukt het delen niet, dan
   * blijft de lijst gewoon op deze telefoon staan en kan het later alsnog.
   */
  const shareIntoGroup = useCallback(
    async (eventId: string) => {
      if (!group || !isSyncConfigured) return;
      const event = useStore.getState().events.find((candidate) => candidate.id === eventId);
      if (!event) return;

      try {
        const { joinCode } = await hostSession(event, newJoinCode());
        setShare(eventId, { joinCode, role: 'admin', lastSyncedAt: Date.now() });
        await attachToGroup(eventId, group.id);
        setEventGroup(eventId, group.id);
      } catch (error) {
        Alert.alert(
          'Niet in de groep gezet',
          describeError(error) +
            '\n\nDe lijst staat wel op deze telefoon. Je kunt hem later alsnog delen via het menu, onder Delen.'
        );
      }
    },
    [group, setShare, setEventGroup]
  );

  return { group, fetching, syncGroup, shareIntoGroup };
}
