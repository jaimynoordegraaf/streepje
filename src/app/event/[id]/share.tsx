import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Text } from '@/components/text';
import { PromptModal } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { correctionsUnlocked, isHostDevice } from '@/lib/pin';
import { newJoinCode, useEvent, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { deleteSharedSession, hostSession, setMemberName } from '@/lib/sync';
import { useEventSync, useSessionMembers } from '@/lib/use-sync';
import { formatDateTime } from '@/lib/export';
import { radius, space, useTheme } from '@/theme';

/** What a joining phone reads out of the QR. */
export const joinUrlFor = (code: string) => `streepje://join?code=${code}`;

export default function ShareScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const setShare = useStore((state) => state.setShare);
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const rememberedName = useStore((state) => state.deviceName);
  const setDeviceName = useStore((state) => state.setDeviceName);
  const bottomInset = useBottomInset();
  const { status, pending, detailsPending, retry } = useEventSync(event);
  const { members, meId } = useSessionMembers(event);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [wipeAsk, setWipeAsk] = useState<'verify' | 'set' | null>(null);

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Delen' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  const startSharing = async (hostName: string) => {
    setBusy(true);
    try {
      // May differ from the code we proposed, if the event was already online.
      const joinCode = await hostSession(event, newJoinCode());
      setShare(id, { joinCode, role: 'host', lastSyncedAt: Date.now() });
      setDeviceName(hostName);
      // Without this the host would be the one phone missing from its own list.
      await setMemberName(id, hostName).catch(() => {});
    } catch (error) {
      Alert.alert(
        'Delen starten mislukt',
        describeError(error)
      );
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = () =>
    Alert.alert(
      'Stoppen met delen op deze telefoon?',
      'Deze telefoon werkt daarna weer op zichzelf. Al verstuurde bestellingen blijven in de gedeelde lijst staan en andere telefoons gaan gewoon door.',
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Stoppen', style: 'destructive', onPress: () => setShare(id, null) },
      ]
    );

  /**
   * Wipe the shared copy from the server, leaving every phone's own copy alone.
   *
   * Guarded like every other destructive action: host phone, correction code.
   * This one deletes other people's data as well as your own, so if anything
   * deserves the code, it is this.
   */
  const doWipe = async () => {
    setBusy(true);
    try {
      await deleteSharedSession(id);
      setShare(id, null);
      Alert.alert(
        'Gedeelde lijst verwijderd',
        'De gegevens staan niet meer op de server. Dit evenement staat nog gewoon op deze telefoon, en op de andere telefoons blijft hun eigen kopie staan.'
      );
    } catch (error) {
      Alert.alert('Verwijderen mislukt', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmWipe = () =>
    Alert.alert(
      'Gedeelde lijst verwijderen?',
      'Alle namen en turfjes worden van de server gewist, ook voor de andere telefoons. Wat op deze telefoon staat blijft staan. Exporteer eerst als je de gegevens nog nodig hebt.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: () => {
            if (correctionsUnlocked(id)) {
              doWipe();
              return;
            }
            setWipeAsk(event.correctionPin ? 'verify' : 'set');
          },
        },
      ]
    );

  const statusLabel =
    status === 'live'
      ? 'Verbonden'
      : status === 'connecting'
        ? 'Verbinden…'
        : status === 'offline'
          ? 'Offline — bestellingen worden op deze telefoon bewaard'
          : status === 'gone'
            ? 'De gedeelde lijst is verwijderd. Wat op deze telefoon staat blijft staan.'
            : 'Niet gedeeld';

  const statusColor =
    status === 'live'
      ? theme.good
      : status === 'offline' || status === 'gone'
        ? theme.danger
        : theme.textDim;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Delen' }} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        {!isSyncConfigured ? (
          <Card style={{ gap: space.sm }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
              Delen is nog niet ingesteld
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
              Deze versie heeft geen servergegevens, dus evenementen blijven op deze telefoon. Zie
              supabase/README.md in het project voor de eenmalige instelling — je hebt een
              Supabase-account, één SQL-script en twee regels in een .env-bestand nodig.
            </Text>
          </Card>
        ) : event.share ? (
          <>
            <Card style={{ alignItems: 'center', gap: space.md }}>
              <SectionTitle>Scan om deel te nemen</SectionTitle>
              <View style={{ backgroundColor: '#FFFFFF', padding: space.md, borderRadius: radius.md }}>
                <QRCode value={joinUrlFor(event.share.joinCode)} size={210} />
              </View>
              <Text style={{ color: theme.textDim, fontSize: 13, textAlign: 'center' }}>
                Of typ deze code op de andere telefoon
              </Text>
              <Text
                style={{
                  color: theme.text,
                  fontSize: 32,
                  fontWeight: '700',
                  letterSpacing: 6,
                }}>
                {event.share.joinCode}
              </Text>
            </Card>

            <Card style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {status === 'connecting' ? <ActivityIndicator color={theme.accent} /> : null}
                <Text style={{ color: statusColor, fontSize: 15, fontWeight: '600', flex: 1 }}>
                  {statusLabel}
                </Text>
              </View>
              {detailsPending ? (
                <Text style={{ color: theme.danger, fontSize: 13 }}>
                  Een wijziging aan namen, prijzen of betalingen staat nog niet op de server.
                  Turfjes wachten vanzelf, maar dit soort wijzigingen wordt pas bewaard als er
                  weer verbinding is.
                </Text>
              ) : null}
              {pending > 0 ? (
                <Text style={{ color: theme.textDim, fontSize: 13 }}>
                  {pending} {pending === 1 ? 'bestelling' : 'bestellingen'} nog te versturen. Ze staan
                  veilig op deze telefoon en gaan er automatisch uit.
                </Text>
              ) : null}
              {status === 'offline' ? (
                <Button title="Nu opnieuw proberen" variant="secondary" onPress={retry} />
              ) : null}
            </Card>

            <View style={{ gap: space.sm }}>
              <SectionTitle>Telefoons ({members.length})</SectionTitle>
              <Card style={{ gap: space.sm }}>
                {members.length === 0 ? (
                  <Text style={{ color: theme.textDim, fontSize: 14 }}>
                    Nog niemand opgehaald.
                  </Text>
                ) : (
                  members.map((member) => (
                    <View
                      key={member.userId}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
                        {member.name ?? 'Naamloos'}
                        {member.userId === meId ? ' (deze telefoon)' : ''}
                      </Text>
                      <Text style={{ color: theme.textDim, fontSize: 12 }}>
                        {formatDateTime(member.joinedAt).slice(11)}
                      </Text>
                    </View>
                  ))
                )}
              </Card>
            </View>

            <View style={{ gap: space.sm }}>
              <Button
                title="Stoppen met delen op deze telefoon"
                variant="danger"
                onPress={stopSharing}
              />
              {isHostDevice(event) ? (
                <>
                  <Button
                    title={busy ? 'Bezig…' : 'Gedeelde lijst verwijderen'}
                    variant="danger"
                    disabled={busy}
                    onPress={confirmWipe}
                  />
                  <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }}>
                    Wist de namen en turfjes van de server, voor iedereen. Elke telefoon houdt
                    zijn eigen kopie, dus er gaat niets verloren van wat er al geturfd is.
                  </Text>
                </>
              ) : null}
            </View>
          </>
        ) : (
          <Card style={{ gap: space.md }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
              Bestellingen opnemen op meerdere telefoons
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
              Door te delen komt dit evenement online te staan, zodat anderen een code kunnen scannen
              en ook kunnen turven. Iedereen ziet dezelfde lopende totalen. Elke telefoon blijft
              werken als het signaal wegvalt en loopt daarna vanzelf bij.
            </Text>
            <Button
              title={busy ? 'Bezig…' : 'Delen starten'}
              disabled={busy}
              onPress={() => setNaming(true)}
            />
          </Card>
        )}
      </ScrollView>

      <PromptModal
        visible={naming}
        title="Hoe heet deze telefoon?"
        placeholder="Naam"
        initialValue={rememberedName ?? ''}
        submitLabel="Delen starten"
        onCancel={() => setNaming(false)}
        onSubmit={(value) => {
          setNaming(false);
          startSharing(value);
        }}
      />

      <PinModal
        visible={wipeAsk !== null}
        mode={wipeAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title="Gedeelde lijst verwijderen"
        explanation={
          wipeAsk === 'set'
            ? 'Er is nog geen correctiecode. Kies er een; die is vanaf nu nodig om te verwijderen.'
            : 'Voer de code in om de gedeelde lijst van de server te wissen.'
        }
        onCancel={() => setWipeAsk(null)}
        onVerified={() => {
          setWipeAsk(null);
          doWipe();
        }}
        onSet={(record) => {
          setCorrectionPin(id, record);
          setWipeAsk(null);
          doWipe();
        }}
      />
    </Screen>
  );
}
