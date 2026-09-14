import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { MenuEditor } from '@/components/menu-editor';
import { PromptModal, whenAlertClosed } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import {
  correctionBlock,
  correctionsUnlocked,
  isAdminDevice,
  unlockCorrections,
} from '@/lib/pin';
import { useEvent, useStore } from '@/lib/store';
import { formatDateTime } from '@/lib/export';
import { activePeople, removedPeople } from '@/lib/totals';
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
  const addPeople = useStore((state) => state.addPeople);
  const defaultPeople = useStore((state) => state.defaultPeople);
  const renamePerson = useStore((state) => state.renamePerson);
  const removePerson = useStore((state) => state.removePerson);
  const restorePerson = useStore((state) => state.restorePerson);
  const setPersonBilling = useStore((state) => state.setPersonBilling);
  const deviceName = useStore((state) => state.deviceName);
  const addItem = useStore((state) => state.addItem);
  const updateItem = useStore((state) => state.updateItem);
  const removeItem = useStore((state) => state.removeItem);

  const [renamingEvent, setRenamingEvent] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<Person | null>(null);
  // 'change' asks for the current code first, then for the new one.
  const [pinStep, setPinStep] = useState<'none' | 'set' | 'change' | 'change-new'>('none');
  // Who is waiting on the PIN before being removed.
  const [removing, setRemoving] = useState<Person | null>(null);
  const [removeAsk, setRemoveAsk] = useState<'verify' | 'set' | null>(null);
  const [deleteAsk, setDeleteAsk] = useState<'verify' | 'set' | null>(null);
  const [reopenAsk, setReopenAsk] = useState<'verify' | 'set' | null>(null);
  const bottomInset = useBottomInset();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Beheer' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

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
        'Iemand verwijderen kan alleen op een telefoon die beheerder is van deze lijst. Een beheerder kan dat onder Delen instellen.'
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

  const doDeleteEvent = () => {
    deleteEvent(id);
    router.dismissTo('/');
  };

  /**
   * Deleting the event is the last way to make an evening's takings vanish, so
   * on an admin phone the PIN is required, like every other way of removing
   * turfs.
   *
   * On a member's phone, deleting only drops this phone's copy: the shared
   * list and everyone else's still stand. That is leaving, not destroying, so
   * it is not blocked -- and a member has no PIN to give.
   */
  const confirmDeleteEvent = () => {
    const guest = !isAdminDevice(event);

    Alert.alert(
      `${event.name} verwijderen?`,
      guest
        ? 'Dit haalt het evenement van deze telefoon. De gedeelde lijst en de andere telefoons blijven ongemoeid.'
        : 'Dit verwijdert het evenement en alles wat erin geturfd is van deze telefoon. Exporteer eerst als je de gegevens nog nodig hebt.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: () => {
            if (guest || correctionsUnlocked(id)) {
              doDeleteEvent();
              return;
            }
            whenAlertClosed(() => setDeleteAsk(event.correctionPin ? 'verify' : 'set'));
          },
        },
      ]
    );
  };

  /**
   * Closing freezes the evening: no more turfs and no new people. Closing is
   * confirmed once. Reopening needs the PIN, because it lets turfs be added to
   * an evening whose money may already have been counted.
   */
  const confirmClose = () => {
    Alert.alert(
      `${event.name} afsluiten?`,
      'Daarna kan er niet meer geturfd worden en kan er niemand meer bij. Betalingen en exporteren blijven werken. Heropenen kan alleen met de correctiecode.',
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Afsluiten', onPress: () => setEventClosed(id, true) },
      ]
    );
  };

  const requestReopen = () => {
    if (correctionsUnlocked(id)) {
      setEventClosed(id, false);
      return;
    }
    setReopenAsk(event.correctionPin ? 'verify' : 'set');
  };

  const reopen = () => {
    unlockCorrections(id);
    setEventClosed(id, false);
    setReopenAsk(null);
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
                <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
              </Pressable>
            </View>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>{event.kind === 'tab' ? 'Leden' : 'Personen'}</SectionTitle>
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
            <Button title="Persoon toevoegen" variant="secondary" onPress={() => setAddingPerson(true)} />
          )}

          {defaultPeople.length > 0 && !event.closed ? (
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
              onPress={() => addPeople(id, defaultPeople.map((person) => person.name))}
            />
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Menu voor dit evenement</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, marginBottom: space.xs }}>
            {isAdminDevice(event)
              ? 'Prijzen hier gelden alleen voor dit evenement. Een nieuwe prijs geldt voor wat je vanaf nu turft; wat al geturfd is houdt zijn prijs.'
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

        <View style={{ gap: space.sm }}>
          <SectionTitle>Correctiecode</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            {isAdminDevice(event)
              ? 'Zonder deze code kan niemand op deze telefoon een turfje weghalen. Turven zelf blijft gewoon één tik. De code staat alleen op deze telefoon: elke beheertelefoon heeft zijn eigen.'
              : 'Turfjes weghalen kan alleen op een beheertelefoon. Op deze telefoon kun je wel turven, maar niets weghalen. Een beheerder kan deze telefoon beheerder maken onder Delen.'}
          </Text>

          {isAdminDevice(event) ? (
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
          {/* A season tab runs for good, so there is nothing to close. */}
          {event.kind === 'event' && isAdminDevice(event) ? (
            <Button
              title={event.closed ? 'Evenement heropenen' : 'Evenement afsluiten'}
              variant="secondary"
              onPress={event.closed ? requestReopen : confirmClose}
            />
          ) : null}
          {event.kind === 'event' && !isAdminDevice(event) ? (
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              {event.closed
                ? 'Dit evenement is afgesloten. Alleen een beheertelefoon kan het heropenen.'
                : 'Alleen een beheertelefoon kan dit evenement afsluiten.'}
            </Text>
          ) : null}
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

      <PinModal
        visible={deleteAsk !== null}
        mode={deleteAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title="Evenement verwijderen"
        explanation={
          deleteAsk === 'set'
            ? 'Er is nog geen correctiecode. Kies er een; die is vanaf nu nodig om te verwijderen.'
            : 'Voer de code in om dit evenement van deze telefoon te verwijderen.'
        }
        onCancel={() => setDeleteAsk(null)}
        onVerified={() => {
          setDeleteAsk(null);
          doDeleteEvent();
        }}
        onSet={(record) => {
          setCorrectionPin(id, record);
          setDeleteAsk(null);
          doDeleteEvent();
        }}
      />

      <PinModal
        visible={reopenAsk !== null}
        mode={reopenAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title="Evenement heropenen"
        explanation={
          reopenAsk === 'set'
            ? 'Er is nog geen correctiecode. Kies er een; die is vanaf nu nodig om te heropenen en om turfjes weg te halen.'
            : 'Voer de code in om dit evenement te heropenen.'
        }
        onCancel={() => setReopenAsk(null)}
        onVerified={reopen}
        onSet={(record) => {
          setCorrectionPin(id, record);
          reopen();
        }}
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
