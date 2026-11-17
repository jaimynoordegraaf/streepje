/**
 * De ledenlijst van de groep, vers en bewaard.
 *
 * Haalt hem op zodra het scherm in beeld komt en luistert naar wijzigingen, zodat
 * een naam die een beheerder toevoegt meteen op de andere telefoons staat. Lukt
 * ophalen niet (geen verbinding), dan blijft de laatst bewaarde stand staan: het
 * kiezen aan de bar hangt niet af van het internet.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { useStore, type StoredRoster } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { fetchRoster, subscribeToRoster } from '@/lib/sync';

export function useRoster(): { roster: StoredRoster | null; refresh: () => Promise<void> } {
  const group = useStore((state) => state.group);
  const stored = useStore((state) => state.roster);
  const setRoster = useStore((state) => state.setRoster);
  const groupId = group?.id ?? null;

  const refresh = useCallback(async () => {
    if (!groupId || !isSyncConfigured) return;
    try {
      const fresh = await fetchRoster(groupId);
      setRoster({ groupId, ...fresh, fetchedAt: Date.now() });
    } catch {
      // Geen bereik, of de migratie is nog niet gedraaid: wat er al stond blijft.
    }
  }, [groupId, setRoster]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!groupId || !isSyncConfigured) return;
    try {
      return subscribeToRoster(groupId, () => void refresh());
    } catch {
      return undefined;
    }
  }, [groupId, refresh]);

  // Een bewaarde ledenlijst van een andere groep is niet van deze telefoon.
  return { roster: stored && stored.groupId === groupId ? stored : null, refresh };
}
