/**
 * De mensen op deze lijst: hernoemen, een toevoeging, op de factuur zetten,
 * verwijderen en terugzetten.
 *
 * Dit stond als stuk van Deze lijst; sinds de Beheer-pagina heeft elk onderdeel
 * zijn eigen scherm. De regels zijn dezelfde gebleven. Iemand verwijderen haalt
 * zijn streepjes uit het totaal, dus het is bewaakt als een streep weghalen: een
 * beheertelefoon en de code (zie `confirmRemovePerson`).
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { PromptModal, SavedPeoplePickerModal, whenAlertClosed } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { askAboutSameName } from '@/components/same-name';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { correctionBlock, correctionsUnlocked, isAdminDevice, unlockCorrections } from '@/lib/pin';
import { findSameName } from '@/lib/names';
import { useEvent, useStore } from '@/lib/store';
import { formatDateTime } from '@/lib/export';
import { activePeople, removedPeople } from '@/lib/totals';
import type { Person } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function PeopleScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);

  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const addPeople = useStore((state) => state.addPeople);
  const defaultPeople = useStore((state) => state.defaultPeople);
  const group = useStore((state) => state.group);
  const roster = useStore((state) => state.roster);
  const sections = useStore((state) => state.sections);
  const renamePerson = useStore((state) => state.renamePerson);
  const removePerson = useStore((state) => state.removePerson);
  const restorePerson = useStore((state) => state.restorePerson);
  const setPersonBilling = useStore((state) => state.setPersonBilling);
  const setPersonNote = useStore((state) => state.setPersonNote);
  const deviceName = useStore((state) => state.deviceName);

  const [pickingSaved, setPickingSaved] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<Person | null>(null);
  const [notingPerson, setNotingPerson] = useState<Person | null>(null);
  // Who is waiting on the PIN before being removed.
  const [removing, setRemoving] = useState<Person | null>(null);
  const [removeAsk, setRemoveAsk] = useState<'verify' | 'set' | null>(null);
  const bottomInset = useBottomInset();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Personen' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  const title = event.kind === 'tab' ? 'Leden' : 'Personen';

  const doRemove = (person: Person) => removePerson(id, person.id, deviceName);

  /**
   * Removing someone takes their turfs out of the total, so it is guarded
   * exactly as removing a single turf is: an admin phone, and the PIN.
   * Without this it was a way round the PIN entirely -- delete the person and
   * their turfs went with them, quietly.
   */
  const confirmRemovePerson = (person: Person) => {
    const block = correctionBlock(event);

    if (!block.allowed && block.reason === 'not-admin') {
      Alert.alert(
        'Alleen op een beheertelefoon',
        'Iemand verwijderen kan alleen op een telefoon die beheerder is van deze lijst. Een beheerder kan dat bij Beheer, onder Delen, instellen.'
      );
      return;
    }

    Alert.alert(
      `${person.name} verwijderen?`,
      'Wat er geturfd is blijft bewaard en is terug te zien bij de totalen, maar telt niet meer mee.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: () => {
            if (correctionsUnlocked(id)) {
              doRemove(person);
              return;
            }
            setRemoving(person);
            whenAlertClosed(() =>
              setRemoveAsk(!block.allowed && block.reason === 'no-pin' ? 'set' : 'verify')
            );
          },
        },
      ]
    );
  };

  /**
   * Moving someone between the invoice and paying tonight decides who gets
   * asked for the money, so it is an admin's call, confirmed once first.
   */
  const confirmBillingChange = (person: Person) => {
    const toInvoice = person.billing !== 'invoice';
    Alert.alert(
      toInvoice ? person.name + ' op de factuur zetten?' : person.name + ' vanavond laten betalen?',
      toInvoice
        ? 'Wat ' + person.name + ' turft gaat dan naar de penningmeester. Doe dit alleen als diens gegevens bekend zijn.'
        : 'Wat ' + person.name + ' turft moet dan aan het eind van de avond betaald worden.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: toInvoice ? 'Op factuur' : 'Vanavond',
          onPress: () => setPersonBilling(id, person.id, toInvoice ? 'invoice' : 'tonight'),
        },
      ]
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: 48 + bottomInset }}>
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
          Voor {event.name}. Hernoemen, een toevoeging, op de factuur zetten, verwijderen en terugzetten.
        </Text>

        <View style={{ gap: space.sm }}>
          <SectionTitle>{title}</SectionTitle>
          {activePeople(event).length === 0 ? (
            <EmptyState title="Nog niemand toegevoegd" />
          ) : (
            activePeople(event).map((person) => (
              <Card key={person.id} style={{ paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                      {person.name}
                    </Text>
                    {event.kind === 'event' ? (
                      <Pressable
                        disabled={!isAdminDevice(event)}
                        onPress={() => confirmBillingChange(person)}
                        hitSlop={6}>
                        <Text
                          style={{
                            color: isAdminDevice(event) ? theme.link : theme.textDim,
                            fontSize: 12,
                            marginTop: 2,
                          }}>
                          {person.billing === 'invoice' ? 'Op factuur' : 'Betaalt vanavond'}
                          {person.memberId ? ' · lid' : ''}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable onPress={() => setRenamingPerson(person)} hitSlop={8}>
                    <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
                  </Pressable>
                  {/* Alleen voor gasten: bij een lid staat de naam al vast in
                      de lopende rekening, en die hoort bij de penningmeester
                      thuis onder zijn eigen naam. */}
                  {person.memberId === null ? (
                    <Pressable onPress={() => setNotingPerson(person)} hitSlop={8}>
                      <Text style={{ color: theme.link, fontWeight: '600' }}>Toevoeging</Text>
                    </Pressable>
                  ) : null}
                  {/* Removing someone changes the takings, so not on a closed event. */}
                  {event.closed ? null : (
                    <Pressable onPress={() => confirmRemovePerson(person)} hitSlop={8}>
                      <Text style={{ color: theme.danger, fontWeight: '600' }}>Verwijderen</Text>
                    </Pressable>
                  )}
                </View>
              </Card>
            ))
          )}
          {removedPeople(event).length > 0 ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Text style={{ color: theme.textDim, fontSize: 13, fontWeight: '700' }}>
                VERWIJDERD
              </Text>
              {removedPeople(event).map((person) => (
                <Card key={person.id} style={{ paddingVertical: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textDim, fontSize: 16, fontWeight: '600' }}>
                        {person.name}
                      </Text>
                      <Text style={{ color: theme.textDim, fontSize: 12 }}>
                        {person.removedAt ? formatDateTime(person.removedAt) : ''}
                        {person.removedBy ? ` · ${person.removedBy}` : ''}
                      </Text>
                    </View>
                    {isAdminDevice(event) && !event.closed ? (
                      <Pressable onPress={() => restorePerson(id, person.id)} hitSlop={8}>
                        <Text style={{ color: theme.link, fontWeight: '600' }}>Terugzetten</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          ) : null}

          {event.closed ? (
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Dit evenement is afgesloten. Heropen het om iemand toe te voegen of te verwijderen.
            </Text>
          ) : (
            // Een naam erbij zetten doe je in het menu van de lijst: daar kijkt de
            // app of de naam er al staat. Hier stond een tweede knop die hetzelfde
            // deed, zonder die controle.
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Iemand erbij? Via het menu ⋯ van de lijst, onder Voor de bar.
            </Text>
          )}

          {/* Zodra de groep een ledenlijst heeft, kies je daaruit via het menu van de
              lijst (Lid toevoegen). De Vaste namen van dit toestel zijn dan overgenomen. */}
          {defaultPeople.length > 0 &&
          !event.closed &&
          !(roster && roster.groupId === group?.id && roster.members.some((m) => m.removedAt === null)) ? (
            <Button
              title={`Vaste namen toevoegen (${
                defaultPeople.filter(
                  (saved) =>
                    !event.people.some(
                      (person) => person.name.toLowerCase() === saved.name.toLowerCase()
                    )
                ).length
              })`}
              variant="secondary"
              onPress={() => setPickingSaved(true)}
            />
          ) : null}
        </View>
      </ScrollView>

      <SavedPeoplePickerModal
        visible={pickingSaved}
        people={defaultPeople}
        sections={sections}
        alreadyIn={event.people.map((person) => person.name)}
        onCancel={() => setPickingSaved(false)}
        onSubmit={(names) => {
          addPeople(id, names);
          setPickingSaved(false);
        }}
      />

      <PinModal
        visible={removeAsk !== null}
        mode={removeAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title={removing ? `${removing.name} verwijderen` : 'Verwijderen'}
        explanation={
          removeAsk === 'set'
            ? 'Er is nog geen correctiecode. Kies er een; die is vanaf nu nodig om te verwijderen.'
            : 'Voer de code in om deze persoon te verwijderen.'
        }
        onCancel={() => {
          setRemoving(null);
          setRemoveAsk(null);
        }}
        onVerified={() => {
          unlockCorrections(id);
          if (removing) doRemove(removing);
          setRemoving(null);
          setRemoveAsk(null);
        }}
        onSet={(record) => {
          setCorrectionPin(id, record);
          unlockCorrections(id);
          if (removing) doRemove(removing);
          setRemoving(null);
          setRemoveAsk(null);
        }}
      />

      <PromptModal
        visible={notingPerson !== null}
        title={notingPerson ? `Toevoeging bij ${notingPerson.name}` : 'Toevoeging'}
        placeholder="bijv. Scouting Nehalennia"
        initialValue={notingPerson?.note ?? ''}
        submitLabel="Opslaan"
        onCancel={() => setNotingPerson(null)}
        onSubmit={(value) => {
          if (notingPerson) setPersonNote(id, notingPerson.id, value);
          setNotingPerson(null);
        }}
      />

      <PromptModal
        visible={renamingPerson !== null}
        title="Persoon hernoemen"
        initialValue={renamingPerson?.name ?? ''}
        onCancel={() => setRenamingPerson(null)}
        onSubmit={(name) => {
          const person = renamingPerson;
          setRenamingPerson(null);
          if (!person) return;
          // Hernoemen naar een naam die er al staat geeft twee regels voor één
          // mens; eerst vragen. De eigen naam met andere hoofdletters mag.
          const match = findSameName(event, name, person.id);
          if (!match) return renamePerson(id, person.id, name);
          askAboutSameName({
            match,
            proceedLabel: 'Toch hernoemen',
            onProceed: () => renamePerson(id, person.id, name),
          });
        }}
      />
    </Screen>
  );
}
