import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { MenuEditor } from '@/components/menu-editor';
import { PromptModal, SectionPickerModal } from '@/components/modals';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { SavedPerson, Section } from '@/lib/types';
import { space, useTheme } from '@/theme';

/**
 * Waar een nieuwe lijst mee begint: het menu, de speltakken en de vaste namen.
 *
 * Eén keer instellen. Dit stond onder Dit toestel, maar drie lange lijsten
 * duwden daar de rest ver naar beneden. Wat hier verandert raakt de lijsten die
 * al bestaan niet; het menu van een lijst zelf staat onder Deze lijst.
 */
export default function NewListsScreen() {
  const theme = useTheme();
  const defaultMenu = useStore((state) => state.defaultMenu);
  const addDefaultItem = useStore((state) => state.addDefaultItem);
  const updateDefaultItem = useStore((state) => state.updateDefaultItem);
  const removeDefaultItem = useStore((state) => state.removeDefaultItem);
  const defaultPeople = useStore((state) => state.defaultPeople);
  const addDefaultPerson = useStore((state) => state.addDefaultPerson);
  const renameDefaultPerson = useStore((state) => state.renameDefaultPerson);
  const removeDefaultPerson = useStore((state) => state.removeDefaultPerson);
  const setDefaultPersonSection = useStore((state) => state.setDefaultPersonSection);
  const sections = useStore((state) => state.sections);
  const addSection = useStore((state) => state.addSection);
  const renameSection = useStore((state) => state.renameSection);
  const removeSection = useStore((state) => state.removeSection);
  const [addingPerson, setAddingPerson] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<SavedPerson | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [renamingSection, setRenamingSection] = useState<Section | null>(null);
  // Wie er op een speltak wacht. De naam staat erbij, zodat het venster kan
  // zeggen over wie het gaat.
  const [sectioningPerson, setSectioningPerson] = useState<SavedPerson | null>(null);
  const bottomInset = useBottomInset();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Voor nieuwe lijsten' }} />

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
          <SectionTitle>Speltakken</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Hoe jullie groep is opgedeeld: loodsenploeg, stam, bestuur, wat er ook is. Je hangt er
            hieronder vaste namen aan, en bij een nieuwe avond vink je dan in één tik een hele
            speltak aan in plaats van iedereen. Een speltak weghalen laat de namen staan.
          </Text>

          {sections.length === 0 ? (
            <EmptyState title="Nog geen speltakken" />
          ) : (
            sections.map((section) => {
              const count = defaultPeople.filter(
                (person) => person.sectionId === section.id
              ).length;
              return (
                <Card key={section.id} style={{ paddingVertical: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                        {section.name}
                      </Text>
                      <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>
                        {count === 1 ? '1 naam' : `${count} namen`}
                      </Text>
                    </View>
                    <Pressable onPress={() => setRenamingSection(section)} hitSlop={8}>
                      <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        Alert.alert(
                          `${section.name} verwijderen?`,
                          'De namen blijven in de vaste lijst staan; ze horen daarna bij geen speltak meer.',
                          [
                            { text: 'Annuleren', style: 'cancel' },
                            {
                              text: 'Verwijderen',
                              style: 'destructive',
                              onPress: () => removeSection(section.id),
                            },
                          ]
                        )
                      }
                      hitSlop={8}>
                      <Text style={{ color: theme.danger, fontWeight: '600' }}>Verwijderen</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })
          )}

          <Button
            title="Speltak toevoegen"
            variant="secondary"
            onPress={() => setAddingSection(true)}
          />
        </View>

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <SectionTitle>Vaste namen</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            De mensen die er meestal zijn, zodat je ze niet elke keer opnieuw hoeft in te typen.
            In het menu van een lijst, onder Beheer, kies je wie er die avond bij komt: een hele speltak, of
            naam voor naam.
          </Text>

          {defaultPeople.length === 0 ? (
            <EmptyState title="Nog geen vaste namen" />
          ) : (
            defaultPeople.map((person) => (
              <Card key={person.id} style={{ paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                      {person.name}
                    </Text>
                    {/* Zonder speltakken valt er niets te kiezen, en dan is een
                        knop die alleen een leeg venster opent erger dan geen
                        knop. De uitleg erboven zegt waar ze vandaan komen. */}
                    {sections.length > 0 ? (
                      <Pressable onPress={() => setSectioningPerson(person)} hitSlop={6}>
                        <Text style={{ color: theme.link, fontSize: 12, marginTop: 2 }}>
                          {sections.find((section) => section.id === person.sectionId)?.name ??
                            'Geen speltak'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
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
      </ScrollView>

      <PromptModal
        visible={addingSection}
        title="Speltak toevoegen"
        placeholder="bijv. Loodsenploeg"
        submitLabel="Toevoegen"
        onCancel={() => setAddingSection(false)}
        onSubmit={(name) => {
          addSection(name);
          setAddingSection(false);
        }}
      />

      <PromptModal
        visible={renamingSection !== null}
        title="Speltak hernoemen"
        initialValue={renamingSection?.name ?? ''}
        onCancel={() => setRenamingSection(null)}
        onSubmit={(name) => {
          if (renamingSection) renameSection(renamingSection.id, name);
          setRenamingSection(null);
        }}
      />

      <SectionPickerModal
        visible={sectioningPerson !== null}
        title={sectioningPerson ? `Speltak van ${sectioningPerson.name}` : 'Speltak'}
        sections={sections}
        value={sectioningPerson?.sectionId ?? null}
        onCancel={() => setSectioningPerson(null)}
        onSubmit={(sectionId) => {
          if (sectioningPerson) setDefaultPersonSection(sectioningPerson.id, sectionId);
          setSectioningPerson(null);
        }}
      />

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
