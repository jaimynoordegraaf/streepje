/**
 * De groep van de barploeg: aanmaken, deelnemen en verlaten.
 *
 * Dit stond als stuk van Dit toestel; sinds de Beheer-pagina heeft elk onderdeel
 * zijn eigen scherm. Niets aan de regels is veranderd.
 */

import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { PromptModal } from '@/components/modals';
import { Text } from '@/components/text';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { newId, newJoinCode, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { createGroup, joinGroup, leaveGroup, leaveSession } from '@/lib/sync';
import { space, useTheme } from '@/theme';

export default function GroupScreen() {
  const theme = useTheme();
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

  // Zonder server is er geen groep. Beheer laat deze rij dan ook weg; dit vangt
  // een scherm dat toch geopend wordt.
  if (!isSyncConfigured) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Groep' }} />
        <EmptyState title="Groepen zijn hier niet beschikbaar" />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Groep' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <View style={{ gap: space.sm }}>
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
      </ScrollView>

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
              `De groepscode is ${made.joinCode}. Geef die door aan de telefoons van de barploeg; ze vinden hem later terug bij Beheer, onder Groep.`
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
              'Je doet mee met deze groep. De lijsten van de groep verschijnen zo onder Alle lijsten.'
            );
          });
        }}
      />
    </Screen>
  );
}
