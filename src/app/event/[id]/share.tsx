import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Text } from '@/components/text';
import { PromptModal } from '@/components/modals';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { newJoinCode, useEvent, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { hostSession, setMemberName } from '@/lib/sync';
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
  const rememberedName = useStore((state) => state.deviceName);
  const setDeviceName = useStore((state) => state.setDeviceName);
  const bottomInset = useBottomInset();
  const { status, pending, retry } = useEventSync(event);
  const { members, meId } = useSessionMembers(event);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);

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
      const joinCode = newJoinCode();
      await hostSession(event, joinCode);
      setShare(id, { joinCode, role: 'host', lastSyncedAt: Date.now() });
      setDeviceName(hostName);
      // Without this the host would be the one phone missing from its own list.
      await setMemberName(id, hostName).catch(() => {});
    } catch (error) {
      Alert.alert(
        'Delen starten mislukt',
        error instanceof Error ? error.message : String(error)
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

  const statusLabel =
    status === 'live'
      ? 'Verbonden'
      : status === 'connecting'
        ? 'Verbinden…'
        : status === 'offline'
          ? 'Offline — bestellingen worden op deze telefoon bewaard'
          : 'Niet gedeeld';

  const statusColor =
    status === 'live' ? theme.good : status === 'offline' ? theme.danger : theme.textDim;

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

            <Button title="Stoppen met delen op deze telefoon" variant="danger" onPress={stopSharing} />
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
    </Screen>
  );
}
