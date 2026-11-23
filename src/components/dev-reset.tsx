/**
 * Alleen in de ontwikkelversie: alles op dit toestel wissen en opnieuw beginnen.
 *
 * Om het eerste openen te testen (het welkomstscherm, meedoen met de groep) moet
 * de app leeg zijn. Op Android kan dat via Instellingen, op een iPhone alleen
 * door de app te verwijderen en opnieuw te installeren. Deze knop doet het
 * zonder dat.
 *
 * Staat achter `__DEV__`, dus hij bestaat niet in een winkelbuild of in een
 * OTA-update: die worden zonder ontwikkelmodus gebundeld. De anonieme inlog
 * staat ook in deze opslag, dus daarna is dit voor de server een nieuw toestel.
 * Daarom eerst de groep verlaten, anders blijft het oude toestel in de groep
 * staan.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, DevSettings, View } from 'react-native';

import { Text } from '@/components/text';
import { Button } from '@/components/ui';
import { useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { leaveGroup } from '@/lib/sync';
import { space, useTheme } from '@/theme';

export function DevReset() {
  const theme = useTheme();

  if (!__DEV__) return null;

  const wipe = async () => {
    const group = useStore.getState().group;
    if (group && isSyncConfigured) {
      try {
        await leaveGroup(group.id);
      } catch (error) {
        Alert.alert(
          'Groep niet verlaten',
          'De groep verlaten lukte niet (geen verbinding, of dit is de laatste groepsbeheerder). Er is niets gewist.'
        );
        return;
      }
    }
    // Eerst de opslag van de lijsten loskoppelen, zodat er tussen wissen en
    // herstarten niets meer wordt teruggeschreven.
    useStore.persist.clearStorage();
    await AsyncStorage.clear();
    DevSettings.reload();
  };

  return (
    <View style={{ gap: space.xs, marginTop: space.md }}>
      <Button
        title="Testversie leegmaken"
        variant="danger"
        onPress={() =>
          Alert.alert(
            'Testversie leegmaken?',
            'Dit toestel verlaat de groep, en daarna wordt alles gewist: lijsten, groep, codes en de inlog. De app start opnieuw alsof hij net is geïnstalleerd. Alleen in de ontwikkelversie.',
            [
              { text: 'Annuleren', style: 'cancel' },
              { text: 'Leegmaken', style: 'destructive', onPress: () => void wipe() },
            ]
          )
        }
      />
      <Text style={{ color: theme.textDim, fontSize: 12, textAlign: 'center' }}>
        Alleen in de ontwikkelversie
      </Text>
    </View>
  );
}
