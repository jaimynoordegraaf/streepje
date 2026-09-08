import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { MenuEditor } from '@/components/menu-editor';
import { PromptModal } from '@/components/modals';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { SavedPerson } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const defaultMenu = useStore((state) => state.defaultMenu);
  const addDefaultItem = useStore((state) => state.addDefaultItem);
  const updateDefaultItem = useStore((state) => state.updateDefaultItem);
  const removeDefaultItem = useStore((state) => state.removeDefaultItem);
  const defaultPeople = useStore((state) => state.defaultPeople);
  const addDefaultPerson = useStore((state) => state.addDefaultPerson);
  const renameDefaultPerson = useStore((state) => state.renameDefaultPerson);
  const removeDefaultPerson = useStore((state) => state.removeDefaultPerson);
  const [addingPerson, setAddingPerson] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<SavedPerson | null>(null);
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

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <SectionTitle>Vaste namen</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            De mensen die er meestal zijn. Bij een evenement voeg je ze in één keer toe, zodat je
            ze niet elke keer opnieuw hoeft in te typen. Wie er die avond niet is, haal je daarna
            gewoon weg.
          </Text>

          {defaultPeople.length === 0 ? (
            <EmptyState title="Nog geen vaste namen" />
          ) : (
            defaultPeople.map((person) => (
              <Card key={person.id} style={{ paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 16, fontWeight: '600' }}>
                    {person.name}
                  </Text>
                  <Pressable onPress={() => setRenamingPerson(person)} hitSlop={8}>
                    <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      Alert.alert(`${person.name} verwijderen?`, undefined, [
                        { text: 'Annuleren', style: 'cancel' },
                        {
                          text: 'Verwijderen',
                          style: 'destructive',
                          onPress: () => removeDefaultPerson(person.id),
                        },
                      ])
                    }
                    hitSlop={8}>
                    <Text style={{ color: theme.danger, fontWeight: '600' }}>Verwijderen</Text>
                  </Pressable>
                </View>
              </Card>
            ))
          )}

          <Button title="Naam toevoegen" variant="secondary" onPress={() => setAddingPerson(true)} />
        </View>

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

      <PromptModal
        visible={addingPerson}
        title="Vaste naam toevoegen"
        placeholder="Naam"
        submitLabel="Toevoegen"
        onCancel={() => setAddingPerson(false)}
        onSubmit={(name) => {
          addDefaultPerson(name);
          setAddingPerson(false);
        }}
      />

      <PromptModal
        visible={renamingPerson !== null}
        title="Naam wijzigen"
        initialValue={renamingPerson?.name ?? ''}
        onCancel={() => setRenamingPerson(null)}
        onSubmit={(name) => {
          if (renamingPerson) renameDefaultPerson(renamingPerson.id, name);
          setRenamingPerson(null);
        }}
      />
    </Screen>
  );
}
