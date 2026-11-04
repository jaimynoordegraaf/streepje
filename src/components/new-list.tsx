/**
 * Een nieuwe lijst aanmaken, vanuit het menu of vanuit het overzicht.
 *
 * Eén hook voor beide, zodat een lijst op elke plek hetzelfde wordt
 * aangemaakt: de naam en het soort, meteen bij de groep als deze telefoon er
 * een heeft, en daarna openen.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';

import { NewListModal } from '@/components/modals';
import { useStore } from '@/lib/store';
import { useGroupSync } from '@/lib/use-group-sync';

export function useNewList() {
  const router = useRouter();
  const createEvent = useStore((state) => state.createEvent);
  const { shareIntoGroup } = useGroupSync();
  const [creating, setCreating] = useState(false);

  const modal = (
    <NewListModal
      visible={creating}
      onCancel={() => setCreating(false)}
      onSubmit={(name, kind) => {
        setCreating(false);
        const id = createEvent(name, kind);
        // Zit deze telefoon in een groep, dan hoort de lijst daar meteen bij.
        // Op de achtergrond, zodat het turven niet op de server hoeft te
        // wachten.
        void shareIntoGroup(id);
        router.push({ pathname: '/event/[id]', params: { id } });
      }}
    />
  );

  return { start: () => setCreating(true), modal };
}
