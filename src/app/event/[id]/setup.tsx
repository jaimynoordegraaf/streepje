import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { MenuEditor } from '@/components/menu-editor';
import { PromptModal } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { isHostDevice } from '@/lib/pin';
import { useEvent, useStore } from '@/lib/store';
import type { Person } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function SetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);

  const renameEvent = useStore((state) => state.renameEvent);
  const deleteEvent = useStore((state) => state.deleteEvent);
  const setEventClosed = useStore((state) => state.setEventClosed);
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const addPerson = useStore((state) => state.addPerson);
  const renamePerson = useStore((state) => state.renamePerson);
  const removePerson = useStore((state) => state.removePerson);
  const addItem = useStore((state) => state.addItem);
  const updateItem = useStore((state) => state.updateItem);
  const removeItem = useStore((state) => state.removeItem);

  const [renamingEvent, setRenamingEvent] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<Person | null>(null);
  // 'change' asks for the current code first, then for the new one.
  const [pinStep, setPinStep] = useState<'none' | 'set' | 'change' | 'change-new'>('none');
  const bottomInset = useBottomInset();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Beheer' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  const confirmRemovePerson = (person: Person) => {
    Alert.alert(
      `Remove ${person.name}?`,
      'Alles wat voor deze persoon geturfd is, wordt ook verwijderd.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: () => removePerson(id, person.id),
        },
      ]
    );
  };

  const confirmDeleteEvent = () => {
    Alert.alert(
      `Delete ${event.name}?`,
      'Dit verwijdert het evenement en alles wat erin geturfd is definitief. Exporteer eerst als je de gegevens nog nodig hebt.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: () => {
            deleteEvent(id);
            router.dismissTo('/');
          },
        },
      ]
    );
  };

  /** How many of this item have already been logged across everyone. */
  const loggedCount = (itemId: string) =>
    event.entries.reduce((sum, entry) => (entry.itemId === itemId ? sum + entry.delta : sum), 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Beheer' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: 48 + bottomInset }}>
        <View style={{ gap: space.sm }}>
          <SectionTitle>Evenement</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Text style={{ flex: 1, color: theme.text, fontSize: 17, fontWeight: '700' }}>
                {event.name}
              </Text>
              <Pressable onPress={() => setRenamingEvent(true)} hitSlop={8}>
                <Text style={{ color: theme.accent, fontWeight: '600' }}>Hernoemen</Text>
              </Pressable>
            </View>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Personen</SectionTitle>
          {event.people.length === 0 ? (
            <EmptyState title="Nog niemand toegevoegd" />
          ) : (
            event.people.map((person) => (
              <Card key={person.id} style={{ paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 16, fontWeight: '600' }}>
                    {person.name}
                  </Text>
                  <Pressable onPress={() => setRenamingPerson(person)} hitSlop={8}>
                    <Text style={{ color: theme.accent, fontWeight: '600' }}>Hernoemen</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmRemovePerson(person)} hitSlop={8}>
                    <Text style={{ color: theme.danger, fontWeight: '600' }}>Verwijderen</Text>
                  </Pressable>
                </View>
              </Card>
            ))
          )}
          <Button title="Persoon toevoegen" variant="secondary" onPress={() => setAddingPerson(true)} />
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Menu voor dit evenement</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, marginBottom: space.xs }}>
            Prices here belong to this event only. Changing them will not affect other events.
          </Text>
          <MenuEditor
            items={event.menu}
            onAdd={(draft) => addItem(id, draft)}
            onUpdate={(itemId, patch) => updateItem(id, itemId, patch)}
            onRemove={(itemId) => removeItem(id, itemId)}
            removeWarning={(item) => {
              const count = loggedCount(item.id);
              return count > 0
                ? `${count} already logged for this item will be removed as well.`
                : null;
            }}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Correctiecode</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            {isHostDevice(event)
              ? 'Zonder deze code kan niemand een turfje weghalen. Turven zelf blijft gewoon één tik. De code staat alleen op deze telefoon en gaat niet mee als je het evenement deelt.'
              : 'Turfjes weghalen kan alleen op de telefoon die dit evenement heeft aangemaakt. Op deze telefoon kun je wel turven, maar niets weghalen.'}
          </Text>

          {isHostDevice(event) ? (
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
                  {event.correctionPin ? 'Ingesteld' : 'Nog niet ingesteld'}
                </Text>
                <Text
                  style={{
                    color: event.correctionPin ? theme.good : theme.danger,
                    fontSize: 13,
                    fontWeight: '700',
                  }}>
                  {event.correctionPin ? 'BEVEILIGD' : 'ONBEVEILIGD'}
                </Text>
              </View>
              <Button
                title={event.correctionPin ? 'Code wijzigen' : 'Code instellen'}
                variant="secondary"
                onPress={() => setPinStep(event.correctionPin ? 'change' : 'set')}
              />
            </Card>
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Afronden</SectionTitle>
          <Button
            title={event.closed ? 'Evenement heropenen' : 'Evenement afsluiten'}
            variant="secondary"
            onPress={() => setEventClosed(id, !event.closed)}
          />
          <Button title="Evenement verwijderen" variant="danger" onPress={confirmDeleteEvent} />
        </View>
      </ScrollView>

      <PromptModal
        visible={renamingEvent}
        title="Evenement hernoemen"
        initialValue={event.name}
        onCancel={() => setRenamingEvent(false)}
        onSubmit={(name) => {
          renameEvent(id, name);
          setRenamingEvent(false);
        }}
      />

      <PromptModal
        visible={addingPerson}
        title="Persoon toevoegen"
        placeholder="Naam"
        submitLabel="Toevoegen"
        onCancel={() => setAddingPerson(false)}
        onSubmit={(name) => {
          addPerson(id, name);
          setAddingPerson(false);
        }}
      />

      <PinModal
        visible={pinStep === 'set' || pinStep === 'change-new'}
        mode="set"
        eventId={id}
        title={pinStep === 'change-new' ? 'Nieuwe correctiecode' : 'Correctiecode instellen'}
        explanation="Vanaf nu is deze code nodig om een turfje weg te halen. Bewaar hem goed: hij staat alleen op deze telefoon en kan niet worden opgezocht."
        onCancel={() => setPinStep('none')}
        onSet={(record) => {
          setCorrectionPin(id, record);
          setPinStep('none');
        }}
      />

      <PinModal
        visible={pinStep === 'change'}
        mode="verify"
        eventId={id}
        record={event.correctionPin}
        title="Huidige code"
        explanation="Voer eerst de huidige code in."
        onCancel={() => setPinStep('none')}
        onVerified={() => setPinStep('change-new')}
      />

      <PromptModal
        visible={renamingPerson !== null}
        title="Persoon hernoemen"
        initialValue={renamingPerson?.name ?? ''}
        onCancel={() => setRenamingPerson(null)}
        onSubmit={(name) => {
          if (renamingPerson) renamePerson(id, renamingPerson.id, name);
          setRenamingPerson(null);
        }}
      />
    </Screen>
  );
}
