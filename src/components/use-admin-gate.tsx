/**
 * Het slot van de beheercode voor een knop buiten het ⋯-menu.
 *
 * Het menu (`gate` in DropdownMenu) vraagt de code voor alles wat achter de
 * beheercode zit. Een knop op een ander scherm die naar zo'n scherm voert, zoals
 * "Logboek van Anne" op het persoonsscherm, mag dat slot niet omzeilen. Dit is
 * dezelfde regel, voor wie hem buiten het menu nodig heeft:
 *
 *  - dezelfde code: die van de lijst waar de app mee opent (`useHomeList`);
 *  - na een goede code staat alles twee minuten open (het venster van pin.ts),
 *    dus Totalen en dan Logboek vraagt maar één keer;
 *  - een telefoon die geen beheerder is van die lijst heeft geen code en komt
 *    er zonder doorheen: wat daar gevaarlijk is, weigert de database toch al.
 *
 * Gebruik: `const { gate, modal } = useAdminGate();` zet `{modal}` ergens in het
 * scherm en roep `gate(() => ...)` aan met wat er na de code moet gebeuren.
 */

import { useState, type ReactElement } from 'react';

import { PinModal } from '@/components/pin-modal';
import { whenAlertClosed } from '@/components/modals';
import { correctionBlock, correctionsUnlocked, unlockCorrections } from '@/lib/pin';
import { useHomeList, useStore } from '@/lib/store';

export function useAdminGate(what = 'Dit deel'): { gate: (open: () => void) => void; modal: ReactElement } {
  const home = useHomeList();
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  // Wat er na de code geopend moet worden, en of de code nog gekozen moet worden.
  const [asking, setAsking] = useState<{ mode: 'verify' | 'set'; open: () => void } | null>(null);

  const gate = (open: () => void) => {
    if (!home) return open();
    const block = correctionBlock(home);
    if (!block.allowed && block.reason === 'not-admin') return open();
    if (correctionsUnlocked(home.id)) return open();
    setAsking({ mode: !block.allowed && block.reason === 'no-pin' ? 'set' : 'verify', open });
  };

  /** De code is goed: venster sluiten, en pas daarna het scherm openen (iOS, zie whenAlertClosed). */
  const unlocked = () => {
    const open = asking?.open;
    if (home) unlockCorrections(home.id);
    setAsking(null);
    if (open) whenAlertClosed(open);
  };

  const modal = (
    <PinModal
      visible={asking !== null && home !== undefined}
      mode={asking?.mode ?? 'verify'}
      eventId={home?.id ?? ''}
      record={home?.correctionPin}
      title="Correctiecode"
      explanation={
        asking?.mode === 'set'
          ? `${what} is alleen voor de beheerder en vraagt een code. Er is nog geen code voor deze lijst: kies er een. Die is ook nodig om een streep weg te halen. Bewaar hem goed: hij staat alleen op deze telefoon en een vergeten code is niet te herstellen.`
          : `Voer de code in om verder te gaan. ${what} is alleen voor de beheerder.`
      }
      onCancel={() => setAsking(null)}
      onVerified={unlocked}
      onSet={(record) => {
        if (home) setCorrectionPin(home.id, record);
        unlocked();
      }}
    />
  );

  return { gate, modal };
}
