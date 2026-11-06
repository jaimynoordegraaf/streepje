import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { Choice, PromptModal } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { correctionBlock } from '@/lib/pin';
import { newId, newJoinCode, useHomeList, useStore } from '@/lib/store';
import { useStartTour } from '@/lib/tour';
import { isSyncConfigured } from '@/lib/supabase';
import { createGroup, joinGroup, leaveGroup, leaveSession, setMemberName } from '@/lib/sync';
import type { Display } from '@/lib/types';
import { versionLine } from '@/lib/version';
import { space, useTheme } from '@/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const deviceName = useStore((state) => state.deviceName);
  const setDeviceName = useStore((state) => state.setDeviceName);
  const events = useStore((state) => state.events);
  const [namingDevice, setNamingDevice] = useState(false);
  const group = useStore((state) => state.group);
  const setGroup = useStore((state) => state.setGroup);
  const setShare = useStore((state) => state.setShare);
  const [makingGroup, setMakingGroup] = useState(false);
  const [joiningGroup, setJoiningGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomInset = useBottomInset();
  const startTour = useStartTour();
  const display = useStore((state) => state.display);
  const setDisplay = useStore((state) => state.setDisplay);
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const home = useHomeList();
  // De stand waar de schakelaar naartoe wil, zolang de code nog gevraagd wordt.
  const [switching, setSwitching] = useState<{ to: Display; mode: 'verify' | 'set' } | null>(null);

  /**
   * Het apparaat omzetten kan alleen met de code van de lijst waar de app mee
   * opent: dezelfde code die een streep weghaalt, van dezelfde beheertelefoon.
   * Er bestaat geen aparte code voor het hele apparaat, en een tweede code om te
   * onthouden zou er alleen voor zorgen dat een van de twee vergeten wordt.
   *
   * Zonder lijst valt er niets te beveiligen: dan gaat hij zonder vragen om.
   */
  const requestDisplay = (to: Display) => {
    if (to === display) return;
    if (!home) {
      setDisplay(to);
      return;
    }
    const block = correctionBlock(home);
    if (!block.allowed && block.reason === 'not-admin') {
      Alert.alert(
        'Alleen op een beheertelefoon',
        'De weergave omzetten kan alleen op een telefoon die beheerder is van de lijst waar de app mee opent.'
      );
      return;
    }
    setSwitching({ to, mode: !block.allowed && block.reason === 'no-pin' ? 'set' : 'verify' });
  };

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
      <Stack.Screen options={{ title: 'Dit toestel' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
          Wat voor dit toestel geldt, voor alle lijsten. Wat bij één lijst hoort staat in het menu
          onder Deze lijst.
        </Text>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Naam van dit toestel</SectionTitle>
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

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <SectionTitle>Weergave</SectionTitle>
          <Card style={{ gap: space.sm }}>
            <Choice
              options={[
                { value: 'bedragen' as const, label: 'Bedragen' },
                { value: 'streepjes' as const, label: 'Streepjes' },
                { value: 'aantallen' as const, label: 'Aantallen' },
              ]}
              value={display}
              onChange={requestDisplay}
            />
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Wat er bij de namen staat. Bij Streepjes staan er streepjes zoals op papier, bij
              Aantallen alleen het aantal. In beide gevallen staan er geen bedragen, zodat niemand
              meekijkt hoeveel iemand heeft. Totalen en de exports laten de bedragen wel zien. Geldt
              alleen voor deze telefoon. Omzetten vraagt de correctiecode.
            </Text>
          </Card>
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

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <SectionTitle>Voor nieuwe lijsten</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Het menu, de speltakken en de vaste namen waar een nieuwe lijst mee begint. Je stelt ze
            één keer in.
          </Text>
          <Button
            title="Menu, speltakken en vaste namen"
            variant="secondary"
            onPress={() => router.push('/nieuwe-lijsten')}
          />
        </View>

        {isSyncConfigured ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <SectionTitle>Ideeën</SectionTitle>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Mis je iets achter de bar, of werkt iets onhandig? Stuur het in. Iedereen uit de
              groep ziet de lijst, dus je ziet meteen of iemand het al bedacht had.
            </Text>
            <Button
              title="Ideeën bekijken en insturen"
              variant="secondary"
              onPress={() => router.push('/ideas')}
            />
          </View>
        ) : null}

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <SectionTitle>Rondleiding</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Een korte wandeling door de app zelf. Hij maakt een voorbeeldlijst aan om iets te
            laten zien en ruimt die daarna weer op; je eigen lijsten blijven zoals ze zijn.
          </Text>
          <Button
            title="Rondleiding opnieuw bekijken"
            variant="secondary"
            onPress={startTour}
          />
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

        <Text style={{ color: theme.textDim, fontSize: 12, textAlign: 'center', marginTop: space.md }}>
          {versionLine()}
        </Text>
      </ScrollView>

      <PinModal
        visible={switching !== null && home !== undefined}
        mode={switching?.mode ?? 'verify'}
        eventId={home?.id ?? ''}
        record={home?.correctionPin}
        title={switching?.mode === 'set' ? 'Kies een correctiecode' : 'Correctiecode'}
        explanation={
          switching?.mode === 'set'
            ? 'Er is nog geen code voor deze lijst. Kies er een; die is nodig om de weergave om te zetten en om een streep weg te halen. Bewaar hem goed, hij staat alleen op deze telefoon.'
            : 'Voer de code in om de weergave van deze telefoon om te zetten.'
        }
        onCancel={() => setSwitching(null)}
        onVerified={() => {
          if (switching) setDisplay(switching.to);
          setSwitching(null);
        }}
        onSet={(record) => {
          if (home) setCorrectionPin(home.id, record);
          if (switching) setDisplay(switching.to);
          setSwitching(null);
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
              'Je doet mee met deze groep. De lijsten van de groep verschijnen zo onder Alle lijsten.'
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

    </Screen>
  );
}
