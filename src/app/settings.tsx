import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { MenuEditor } from '@/components/menu-editor';
import { Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { useStore } from '@/lib/store';
import { space, useTheme } from '@/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const defaultMenu = useStore((state) => state.defaultMenu);
  const addDefaultItem = useStore((state) => state.addDefaultItem);
  const updateDefaultItem = useStore((state) => state.updateDefaultItem);
  const removeDefaultItem = useStore((state) => state.removeDefaultItem);
  const bottomInset = useBottomInset();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Instellingen' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <View style={{ gap: space.sm }}>
          <SectionTitle>Standaardmenu</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Elk nieuw evenement begint met een kopie van deze lijst, zodat je je drankjes en prijzen
            niet steeds opnieuw hoeft in te typen. Wijzigingen hier veranderen niets aan
            evenementen die al bestaan.
          </Text>
        </View>

        <MenuEditor
          items={defaultMenu}
          onAdd={addDefaultItem}
          onUpdate={updateDefaultItem}
          onRemove={removeDefaultItem}
        />

        <View style={{ gap: space.xs, marginTop: space.md }}>
          <SectionTitle>Over je gegevens</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Zolang je een evenement niet deelt, blijft alles alleen op deze telefoon staan. Deel je
            het wel, dan worden de bestellingen op de server bewaard zodat andere telefoons ze
            kunnen zien. Exporteer een evenement naar CSV voordat je het verwijdert: verwijderen
            kan niet ongedaan worden gemaakt.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
