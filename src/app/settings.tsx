import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { MenuEditor } from '@/components/menu-editor';
import { PromptModal } from '@/components/modals';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { newId, newJoinCode, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { createGroup, joinGroup, leaveGroup, leaveSession, setMemberName } from '@/lib/sync';
import type { SavedPerson } from '@/lib/types';
import { versionLine } from '@/lib/version';
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
  const deviceName = useStore((state) => state.deviceName);
  const setDeviceName = useStore((state) => state.setDeviceName);
  const events = useStore((state) => state.events);
  const [addingPerson, setAddingPerson] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<SavedPerson | null>(null);
  const [namingDevice, setNamingDevice] = useState(false);
  const group = useStore((state) => state.group);
  const setGroup = useStore((state) => state.setGroup);
  const setShare = useStore((state) => state.setShare);
  const [makingGroup, setMakingGroup] = useState(false);
  const [joiningGroup, setJoiningGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomInset = useBottomInset();

  /** Rond een groepsactie af en maak van een mislukking een leesbare melding. */
  const runGroup = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert('Groep', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  /**
   * De groep verlaten, en dan ook echt los zijn.
   *
   * Een telefoon die lijsten van de groep ophaalt meldt zich daar ook bij aan,
   * zodat een beheerder hem beheerder kan maken. Blijft die aanmelding staan,
   * dan houdt deze telefoon toegang via een achterdeur. Dus bij het verlaten
   * gaan die aanmeldingen er ook af. Wat al geturfd is blijft in de lijsten
   * staan; dat is van de lijst, niet van de telefoon.
   */
  const confirmLeaveGroup = () => {
    if (!group) return;
    Alert.alert(
      `${group.name} verlaten?`,
      'Deze telefoon loopt daarna niet meer mee met de lijsten van de groep. Ze blijven als eigen kopie staan, maar worden niet meer bijgewerkt. Wat er geturfd is blijft in de lijsten staan en de andere telefoons merken er niets van.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verlaten',
          style: 'destructive',
          onPress: () =>
            runGroup(async () => {
              for (const event of useStore.getState().events) {
                if (event.groupId !== group.id || !event.share) continue;
                // Best effort: de laatste beheerder van een lijst mag niet weg,
                // en zonder bereik lukt het ook niet. Dan blijft die ene lijst
                // meelopen tot er op het Delen-scherm wordt gestopt.
                await leaveSession(event.id).catch(() => {});
                setShare(event.id, null);
              }
              await leaveGroup(group.id);
              setGroup(null);
            }),
        },
      ]
    );
  };

  /**
   * The name this phone carries into a shared list.
   *
   * Set here, it is already known when you join one, so joining is a scan and
   * nothing else. Changing it also renames this phone in every list it has
   * already joined, so the others do not keep seeing the old name. That part is
   * best effort: a list that cannot be reached right now keeps the old name
   * until the name is set again.
   */
  const renameDevice = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setDeviceName(trimmed);
    for (const event of events) {
      if (event.share) setMemberName(event.id, trimmed).catch(() => {});
    }
  };

  const sharedCount = events.filter((event) => event.share).length;

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

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <SectionTitle>Deze telefoon</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            De naam die de andere telefoons zien bij een gedeelde lijst, zodat duidelijk is welke
            telefoon meetelt. Bijvoorbeeld je eigen naam of &quot;Bar&quot;.
          </Text>
          <Card style={{ paddingVertical: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Text
                style={{
                  flex: 1,
                  color: deviceName ? theme.text : theme.textDim,
                  fontSize: 16,
                  fontWeight: '600',
                }}>
                {deviceName ?? 'Nog geen naam'}
              </Text>
              <Pressable onPress={() => setNamingDevice(true)} hitSlop={8}>
                <Text style={{ color: theme.link, fontWeight: '600' }}>
                  {deviceName ? 'Wijzigen' : 'Instellen'}
                </Text>
              </Pressable>
            </View>
          </Card>
          {deviceName && sharedCount > 0 ? (
            <Text style={{ color: theme.textDim, fontSize: 12 }}>
              Een wijziging geldt ook voor {sharedCount === 1 ? 'de gedeelde lijst' : `de ${sharedCount} gedeelde lijsten`} waar deze telefoon al aan meedoet.
            </Text>
          ) : null}
        </View>

        {isSyncConfigured ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <SectionTitle>Groep</SectionTitle>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Voor de barploeg: één code voor de hele groep, één keer scannen. Daarna verschijnt
              elke lijst van de groep vanzelf op deze telefoon, zonder losse codes per lijst.
              Corrigeren en betalingen blijven voorbehouden aan beheertelefoons.
            </Text>

            {group ? (
              <>
                <Card style={{ gap: space.sm }}>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                    {group.name}
                  </Text>
                  <Text style={{ color: theme.textDim, fontSize: 13 }}>
                    Groepscode, voor wie er nog bij moet
                  </Text>
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: 28,
                      fontWeight: '700',
                      letterSpacing: 5,
                    }}>
                    {group.joinCode}
                  </Text>
                </Card>
                <Button
                  title={busy ? 'Bezig…' : 'Groep verlaten'}
                  variant="danger"
                  disabled={busy}
                  onPress={confirmLeaveGroup}
                />
              </>
            ) : (
              <>
                <Button
                  title="Deelnemen met groepscode"
                  disabled={busy}
                  onPress={() => setJoiningGroup(true)}
                />
                <Button
                  title="Nieuwe groep aanmaken"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setMakingGroup(true)}
                />
                <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
                  Eén iemand maakt de groep aan en geeft de code door; de rest neemt deel. Iedereen
                  met die code kan alle lijsten van de groep zien en erin turven.
                </Text>
              </>
            )}
          </View>
        ) : null}

        <View style={{ gap: space.xs, marginTop: space.md }}>
          <SectionTitle>Over je gegevens</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Zolang je een evenement niet deelt, blijft alles alleen op deze telefoon staan. Deel je
            het wel, dan worden de bestellingen op de server bewaard zodat andere telefoons ze
            kunnen zien. Exporteer een evenement naar CSV voordat je het verwijdert: verwijderen
            kan niet ongedaan worden gemaakt.
          </Text>
        </View>

        <Text style={{ color: theme.textDim, fontSize: 12, textAlign: 'center', marginTop: space.md }}>
          {versionLine()}
        </Text>
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
        visible={makingGroup}
        title="Nieuwe groep"
        placeholder="Naam, bijv. Barploeg JWF"
        submitLabel="Aanmaken"
        onCancel={() => setMakingGroup(false)}
        onSubmit={(name) => {
          setMakingGroup(false);
          const trimmed = name.trim();
          if (trimmed === '') return;
          runGroup(async () => {
            const made = await createGroup(newId(), trimmed, newJoinCode());
            setGroup(made);
            Alert.alert(
              'Groep aangemaakt',
              `De groepscode is ${made.joinCode}. Geef die door aan de telefoons van de barploeg; ze vinden hem later terug onder Instellingen.`
            );
          });
        }}
      />

      <PromptModal
        visible={joiningGroup}
        title="Deelnemen aan een groep"
        placeholder="Groepscode, bijv. K4P7QX"
        submitLabel="Deelnemen"
        onCancel={() => setJoiningGroup(false)}
        onSubmit={(code) => {
          setJoiningGroup(false);
          const trimmed = code.trim();
          if (trimmed === '') return;
          runGroup(async () => {
            const joined = await joinGroup(trimmed);
            setGroup(joined);
            Alert.alert(
              joined.name,
              'Je doet mee met deze groep. De lijsten verschijnen zo op het beginscherm.'
            );
          });
        }}
      />

      <PromptModal
        visible={namingDevice}
        title="Naam van deze telefoon"
        placeholder="Naam"
        initialValue={deviceName ?? ''}
        submitLabel="Opslaan"
        onCancel={() => setNamingDevice(false)}
        onSubmit={(name) => {
          renameDevice(name);
          setNamingDevice(false);
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
