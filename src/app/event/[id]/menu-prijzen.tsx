/**
 * Het menu en de prijzen van deze lijst.
 *
 * Dit stond als stuk van Deze lijst; sinds de Beheer-pagina heeft elk onderdeel
 * zijn eigen scherm. De bewerker zelf (`MenuEditor`) is dezelfde gebleven.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { MenuEditor } from '@/components/menu-editor';
import { Text } from '@/components/text';
import { EmptyState, Screen, useBottomInset } from '@/components/ui';
import { isAdminDevice } from '@/lib/pin';
import { useEvent, useStore } from '@/lib/store';
import { space, useTheme } from '@/theme';

export default function MenuPricesScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const addItem = useStore((state) => state.addItem);
  const updateItem = useStore((state) => state.updateItem);
  const removeItem = useStore((state) => state.removeItem);
  const bottomInset = useBottomInset();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Menu en prijzen' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  /** How many of this item have already been logged across everyone. */
  const loggedCount = (itemId: string) =>
    event.entries.reduce((sum, entry) => (entry.itemId === itemId ? sum + entry.delta : sum), 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Menu en prijzen' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <View style={{ gap: space.sm }}>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            {isAdminDevice(event)
              ? `Voor ${event.name}. Prijzen hier gelden alleen voor deze lijst. Een nieuwe prijs geldt voor wat je vanaf nu turft; wat al geturfd is houdt zijn prijs.`
              : 'Alleen een beheertelefoon kan het menu en de prijzen aanpassen.'}
          </Text>
          <MenuEditor
            items={event.menu}
            readOnly={!isAdminDevice(event)}
            onAdd={(draft) => addItem(id, draft)}
            onUpdate={(itemId, patch) => updateItem(id, itemId, patch)}
            onRemove={(itemId) => removeItem(id, itemId)}
            removeWarning={(item) => {
              const count = loggedCount(item.id);
              // Removing only hides the item: turfs already made keep counting.
              return count > 0
                ? `${count} keer geturfd. Die turfjes blijven meetellen; het item verdwijnt alleen van het menu.`
                : null;
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
