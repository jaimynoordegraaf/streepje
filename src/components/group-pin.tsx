/**
 * Het slot op wat een groepsbeheerder doet: een lijst van een ander toestel
 * verwijderen, en groepsbeheerders aanwijzen of intrekken.
 *
 * Net als bij de correctiecode van een lijst: een telefoon van een beheerder,
 * plus een code die alleen op die telefoon staat. De database kijkt zelf of het
 * toestel groepsbeheerder is (022), dus een aangepaste app komt er niet verder
 * mee; de code houdt iemand tegen die even een telefoon van een beheerder in
 * handen heeft. De eerste keer kiest het toestel zijn code. Na een goede code
 * staat het twee minuten open, zoals bij corrigeren (pin.ts).
 *
 * Wordt dit vanuit een Alert-knop aangeroepen, ga dan via `whenAlertClosed`:
 * een venster dat opent terwijl een Alert nog wegglijdt, verschijnt op iOS niet.
 */

import { useState, type ReactNode } from 'react';

import { PinModal } from '@/components/pin-modal';
import { correctionsUnlocked, unlockCorrections } from '@/lib/pin';
import { useStore } from '@/lib/store';

export function useGroupPinGate(title: string): {
  gate: (then: () => void) => void;
  modal: ReactNode;
} {
  const group = useStore((state) => state.group);
  const groupPin = useStore((state) => state.groupPin);
  const setGroupPin = useStore((state) => state.setGroupPin);
  const [asking, setAsking] = useState<{ mode: 'verify' | 'set'; then: () => void } | null>(null);
  // Een eigen sleutel naast die van de lijsten, voor het open venster en voor de
  // rem op raden.
  const key = `groep:${group?.id ?? ''}`;

  const gate = (then: () => void) => {
    if (correctionsUnlocked(key)) return then();
    setAsking({ mode: groupPin ? 'verify' : 'set', then });
  };

  const done = () => {
    unlockCorrections(key);
    const then = asking?.then;
    setAsking(null);
    then?.();
  };

  const modal = (
    <PinModal
      visible={asking !== null}
      mode={asking?.mode ?? 'verify'}
      eventId={key}
      record={groupPin}
      title={title}
      explanation={
        asking?.mode === 'set'
          ? 'Kies een groepsbeheercode voor dit toestel. Die is vanaf nu nodig om lijsten van de groep te verwijderen en groepsbeheerders aan te wijzen. Hij blijft op dit toestel.'
          : 'Voer de groepsbeheercode van dit toestel in.'
      }
      onCancel={() => setAsking(null)}
      onVerified={done}
      onSet={(record) => {
        setGroupPin(record);
        done();
      }}
    />
  );

  return { gate, modal };
}
