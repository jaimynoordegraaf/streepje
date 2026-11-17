/**
 * De vraag als een naam er al staat.
 *
 * Een tweede "Jan" is soms echt een tweede Jan, dus dit weigert niet. Het
 * vraagt, en laat de keuze: naar de Jan die er al staat, of toch een nieuwe.
 * Bij een verwijderde naam kan niemand aan de bar iets terugzetten (dat is voor
 * de beheerder, achter de code), dus daar staat alleen wat er aan de hand is.
 *
 * De vraag komt pas als het venster waaruit hij komt echt dicht is
 * (`whenAlertClosed`): een melding openen terwijl een Modal nog wegglijdt
 * faalt op iOS stilletjes.
 */

import { Alert } from 'react-native';

import { whenAlertClosed } from '@/components/modals';
import type { Person } from '@/lib/types';

export function askAboutSameName({
  match,
  proceedLabel,
  onProceed,
  onGoTo,
}: {
  match: { person: Person; removed: boolean };
  /** Wat de knop heet die toch doorgaat: "Toch toevoegen", "Toch hernoemen". */
  proceedLabel: string;
  onProceed: () => void;
  /** Alleen als de naam nog meedoet: naar die persoon toe. */
  onGoTo?: (person: Person) => void;
}): void {
  const { person, removed } = match;
  whenAlertClosed(() => {
    if (removed) {
      Alert.alert(
        `${person.name} is eerder verwijderd`,
        'Wat die persoon had staat nog in het logboek. Een beheerder kan hem terugzetten onder Deze lijst, dan komt alles weer op één regel. Een nieuwe naam maakt een tweede regel.',
        [
          { text: 'Annuleren', style: 'cancel' },
          { text: proceedLabel, onPress: onProceed },
        ]
      );
      return;
    }
    Alert.alert(
      `${person.name} staat er al`,
      'Twee keer dezelfde naam geeft twee regels op de lijst, en op de factuur. Bedoel je die die er al staat?',
      [
        { text: 'Annuleren', style: 'cancel' },
        ...(onGoTo ? [{ text: `Naar ${person.name}`, onPress: () => onGoTo(person) }] : []),
        { text: proceedLabel, style: 'destructive' as const, onPress: onProceed },
      ]
    );
  });
}
