/**
 * Meedoen met een groep: de QR scannen of de groepscode intypen.
 *
 * Dit was het scherm om met een code aan één lijst deel te nemen. Dat bestaat
 * niet meer: een toestel doet mee met de groep, en de lijsten komen daarna
 * vanzelf. De camera en het intypen zijn gebleven.
 *
 * De naam van het toestel wordt eerst gevraagd, vóór de camera opengaat: de
 * anderen zien hem op het Groep-scherm en in het logboek, en er achteraf om
 * vragen zou het scannen onderbreken.
 *
 * Komt het scherm open via een gescande link (streepje://groep/meedoen?code=…),
 * dan wordt er eerst gevraagd of dat de bedoeling is. Anders kan een link op een
 * website een telefoon stil in een vreemde groep zetten, en gaan zijn nieuwe
 * lijsten daarheen.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { PromptModal } from '@/components/modals';
import { Text } from '@/components/text';
import { Button, Card, Field, Screen, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { groupCodeFrom, groupErrorText } from '@/lib/group-lists';
import { useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { fetchGroupSessions, joinGroup, setGroupMemberName } from '@/lib/sync';
import { fetchIntoDevice } from '@/lib/use-group-sync';
import { radius, space, useTheme } from '@/theme';

type Fetched = { name: string; state: 'busy' | 'done' | 'later' | 'failed' };

export default function JoinGroupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const bottomInset = useBottomInset();
  const group = useStore((state) => state.group);
  const setGroup = useStore((state) => state.setGroup);
  const rememberedName = useStore((state) => state.deviceName);
  const setDeviceName = useStore((state) => state.setDeviceName);

  const [name, setName] = useState<string | null>(rememberedName);
  const [draftName, setDraftName] = useState(rememberedName ?? '');
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  // Een code uit een link wacht op een bevestiging; zie de uitleg bovenaan.
  const [linkCode, setLinkCode] = useState<string | null>(() =>
    params.code ? groupCodeFrom(params.code) : null
  );
  const [joined, setJoined] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched[]>([]);
  // Een QR in beeld wordt steeds opnieuw gelezen; zo gebeurt er maar één keer iets.
  const handled = useRef(false);

  const join = async (rawValue: string) => {
    const code = groupCodeFrom(rawValue);
    if (!code) {
      handled.current = false;
      Alert.alert('Geen groepscode', 'Dit lijkt geen groepscode van streepje te zijn.');
      return;
    }

    setBusy(true);
    try {
      const made = await joinGroup(code);
      setGroup(made);
      if (name) await setGroupMemberName(made.id, name).catch(() => {});
      setJoined(made.name);

      // De open lijsten en de lopende rekening meteen ophalen, zodat je kunt
      // turven. Afgesloten avonden staan op het Groep-scherm, om op te halen.
      const listings = await fetchGroupSessions(made.id).catch(() => []);
      const known = new Set(useStore.getState().events.map((event) => event.id));
      const fresh = listings.filter((listing) => !known.has(listing.id));
      const rows: Fetched[] = fresh.map((listing) => ({
        name: listing.name || 'Lopende rekening',
        state: listing.closed ? 'later' : 'busy',
      }));
      setFetched([...rows]);
      for (const [index, listing] of fresh.entries()) {
        if (listing.closed) continue;
        try {
          await fetchIntoDevice(listing);
          rows[index] = { ...rows[index], state: 'done' };
        } catch {
          rows[index] = { ...rows[index], state: 'failed' };
        }
        setFetched([...rows]);
      }
    } catch (error) {
      handled.current = false;
      const message = describeError(error);
      Alert.alert('Meedoen mislukt', groupErrorText(message) ?? message);
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    if (!isSyncConfigured) {
      return (
        <Card style={{ gap: space.sm }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Groepen zijn hier niet ingesteld
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            Deze versie heeft geen servergegevens. Zie supabase/README.md in het project voor de
            eenmalige instelling.
          </Text>
        </Card>
      );
    }

    if (joined) {
      return (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
            Je doet mee met {joined}
          </Text>
          {fetched.length === 0 && !busy ? (
            <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
              Er staan nog geen lijsten in de groep. Maak er een, dan zien de anderen hem vanzelf.
            </Text>
          ) : (
            fetched.map((row, index) => (
              <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {row.state === 'busy' ? <ActivityIndicator color={theme.accent} /> : null}
                <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{row.name}</Text>
                <Text style={{ color: row.state === 'failed' ? theme.danger : theme.textDim, fontSize: 13 }}>
                  {row.state === 'done'
                    ? 'Opgehaald'
                    : row.state === 'later'
                      ? 'Afgesloten, op te halen bij Groep'
                      : row.state === 'failed'
                        ? 'Lukte niet, komt later'
                        : ''}
                </Text>
              </View>
            ))
          )}
          <Button title="Naar de lijst" disabled={busy} onPress={() => router.dismissTo('/')} />
        </Card>
      );
    }

    if (group) {
      return (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Dit toestel doet al mee met {group.name}
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            Een toestel zit in één groep. Wil je naar een andere groep, verlaat deze dan eerst bij
            Beheer › Groep.
          </Text>
          <Button title="Naar Groep" variant="secondary" onPress={() => router.replace('/groep')} />
        </Card>
      );
    }

    if (busy) {
      return (
        <Card style={{ alignItems: 'center', gap: space.md }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={{ color: theme.textDim }}>Bezig met meedoen…</Text>
        </Card>
      );
    }

    if (!name) {
      const save = () => {
        const trimmed = draftName.trim();
        if (!trimmed) return;
        setDeviceName(trimmed);
        setName(trimmed);
      };
      return (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Hoe heet dit toestel?
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            De anderen in de groep zien deze naam, en hij staat in het logboek bij elke turf.
            Bijvoorbeeld je eigen naam of &quot;Bar&quot;.
          </Text>
          <Field
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Naam"
            autoFocus
            onSubmitEditing={save}
          />
          <Button title="Verder" disabled={draftName.trim() === ''} onPress={save} />
        </Card>
      );
    }

    if (linkCode) {
      return (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Meedoen met de groep met code {linkCode}?
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            Dit toestel ziet daarna alle lijsten van die groep, en nieuwe lijsten van dit toestel
            komen erin. Doe alleen mee als je deze code van je eigen barploeg hebt.
          </Text>
          <Button title="Meedoen" onPress={() => join(linkCode)} />
          <Button title="Niet nu" variant="secondary" onPress={() => setLinkCode(null)} />
        </Card>
      );
    }

    if (!permission) {
      return (
        <Card>
          <Text style={{ color: theme.textDim }}>Cameratoestemming controleren…</Text>
        </Card>
      );
    }

    if (!permission.granted) {
      return (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Cameratoegang nodig
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            De camera wordt alleen gebruikt om de QR-code te lezen. Er wordt niets opgenomen of
            verstuurd.
          </Text>
          <Button title="Camera toestaan" onPress={requestPermission} />
          <Button title="Code intypen" variant="secondary" onPress={() => setTyping(true)} />
        </Card>
      );
    }

    return (
      <>
        <View
          style={{
            height: 320,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: '#000000',
          }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              handled.current = true;
              join(data);
            }}
          />
        </View>
        <Text style={{ color: theme.textDim, fontSize: 14, textAlign: 'center' }}>
          Richt de camera op de QR van de groep, op een toestel dat al meedoet: Beheer › Groep ›
          QR tonen.
        </Text>
        <Button title="Code intypen" variant="secondary" onPress={() => setTyping(true)} />
      </>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Meedoen met een groep' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.lg + bottomInset }}>
        {body()}
      </ScrollView>

      <PromptModal
        visible={typing}
        title="Groepscode"
        placeholder="bijv. K4P7QX"
        submitLabel="Meedoen"
        onCancel={() => setTyping(false)}
        onSubmit={(value) => {
          setTyping(false);
          join(value);
        }}
      />
    </Screen>
  );
}
