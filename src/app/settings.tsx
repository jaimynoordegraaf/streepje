import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { Choice, PromptModal } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { correctionBlock } from '@/lib/pin';
import { useHomeList, useStore } from '@/lib/store';
import { setMemberName } from '@/lib/sync';
import type { Display } from '@/lib/types';
import { versionLine } from '@/lib/version';
import { space, useTheme } from '@/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const deviceName = useStore((state) => state.deviceName);
  const setDeviceName = useStore((state) => state.setDeviceName);
  const events = useStore((state) => state.events);
  const [namingDevice, setNamingDevice] = useState(false);
  const bottomInset = useBottomInset();
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
      <Stack.Screen options={{ title: 'Naam en weergave' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
          Wat voor dit toestel geldt, voor alle lijsten. Wat bij één lijst hoort staat bij Beheer, onder
          De lijst instellen.
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
