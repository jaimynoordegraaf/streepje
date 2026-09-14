import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Text } from '@/components/text';
import { PromptModal } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { correctionsUnlocked, isAdminDevice, unlockCorrections } from '@/lib/pin';
import { newJoinCode, useEvent, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  addAdmin,
  deleteSharedSession,
  hostSession,
  removeAdmin,
  setMemberName,
} from '@/lib/sync';
import type { SessionMember } from '@/lib/types';
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
  const { members, admins, meId, reload } = useSessionMembers(event);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [wipeAsk, setWipeAsk] = useState<'verify' | 'set' | null>(null);
  // A change to who is an admin, waiting on this phone's PIN.
  const [adminChange, setAdminChange] = useState<{ userId: string; make: boolean } | null>(null);
  const [adminAsk, setAdminAsk] = useState<'verify' | 'set' | null>(null);

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
      setShare(id, { joinCode, role: 'admin', lastSyncedAt: Date.now() });
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

  /** The database refuses in English; say it in the language of the app. */
  const adminErrorText = (error: unknown) => {
    const message = describeError(error);
    if (message.includes('at least one admin')) {
      return 'Een lijst houdt altijd minstens één beheerder.';
    }
    if (message.includes('has not joined')) {
      return 'Die telefoon doet niet meer mee aan deze lijst.';
    }
    if (message.includes('Only an admin')) {
      return 'Alleen een beheerder kan dit. Misschien is deze telefoon net geen beheerder meer.';
    }
    return message;
  };

  const doAdminChange = async (change: { userId: string; make: boolean }) => {
    setBusy(true);
    try {
      if (change.make) await addAdmin(id, change.userId);
      else await removeAdmin(id, change.userId);
    } catch (error) {
      Alert.alert('Beheerders wijzigen mislukt', adminErrorText(error));
    } finally {
      setBusy(false);
      // Realtime normally brings the change in, but not on a flaky connection.
      reload();
    }
  };

  /**
   * Who may correct the list is guarded like a correction itself: an admin
   * phone and its PIN. Without the PIN, anyone handed an admin phone for a
   * moment could make their own phone an admin and keep that power.
   */
  const confirmAdminChange = (member: SessionMember, make: boolean) => {
    const self = member.userId === meId;
    const name = self ? 'Deze telefoon' : (member.name ?? 'Naamloze telefoon');

    Alert.alert(
      make ? `${name} beheerder maken?` : `${name} geen beheerder meer?`,
      make
        ? 'Die telefoon kan daarna turfjes en mensen weghalen, betalingen vastleggen, het menu en de prijzen aanpassen, de lijst verwijderen en zelf beheerders aanwijzen. Hij kiest daarvoor zijn eigen correctiecode.'
        : self
          ? 'Deze telefoon kan daarna niets meer corrigeren. Alleen een andere beheerder kan dat terugdraaien.'
          : 'Die telefoon kan daarna alleen nog turven.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: make ? 'Beheerder maken' : 'Intrekken',
          style: make ? 'default' : 'destructive',
          onPress: () => {
            const change = { userId: member.userId, make };
            if (correctionsUnlocked(id)) {
              doAdminChange(change);
              return;
            }
            setAdminChange(change);
            setAdminAsk(event.correctionPin ? 'verify' : 'set');
          },
        },
      ]
    );
  };

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
              <Card style={{ gap: space.md }}>
                {members.length === 0 ? (
                  <Text style={{ color: theme.textDim, fontSize: 14 }}>
                    Nog niemand opgehaald.
                  </Text>
                ) : (
                  members.map((member) => {
                    const memberIsAdmin = admins.includes(member.userId);
                    // The last admin cannot be removed, so there is nothing to offer.
                    const lastAdmin = memberIsAdmin && admins.length === 1;
                    return (
                      <View
                        key={member.userId}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
                            {member.name ?? 'Naamloos'}
                            {member.userId === meId ? ' (deze telefoon)' : ''}
                          </Text>
                          <Text
                            style={{
                              color: memberIsAdmin ? theme.good : theme.textDim,
                              fontSize: 12,
                              fontWeight: memberIsAdmin ? '700' : '400',
                            }}>
                            {memberIsAdmin ? 'Beheerder' : 'Turft mee'} ·{' '}
                            {formatDateTime(member.joinedAt).slice(11)}
                          </Text>
                        </View>
                        {isAdminDevice(event) && !lastAdmin ? (
                          <Pressable
                            onPress={() => confirmAdminChange(member, !memberIsAdmin)}
                            disabled={busy}
                            hitSlop={8}>
                            <Text
                              style={{
                                color: memberIsAdmin ? theme.danger : theme.link,
                                fontWeight: '600',
                              }}>
                              {memberIsAdmin ? 'Intrekken' : 'Maak beheerder'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </Card>
              {isAdminDevice(event) && admins.length === 1 ? (
                <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 18 }}>
                  Er is maar één beheertelefoon. Raakt die kwijt of wordt de app opnieuw
                  geïnstalleerd, dan kan niemand deze lijst nog corrigeren. Maak een tweede
                  telefoon beheerder.
                </Text>
              ) : null}
            </View>

            <View style={{ gap: space.sm }}>
              <Button
                title="Stoppen met delen op deze telefoon"
                variant="danger"
                onPress={stopSharing}
              />
              {isAdminDevice(event) ? (
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
        visible={adminAsk !== null}
        mode={adminAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title="Beheerders wijzigen"
        explanation={
          adminAsk === 'set'
            ? 'Deze telefoon heeft nog geen correctiecode. Kies er een; die is vanaf nu nodig om beheerders te wijzigen en om te corrigeren.'
            : 'Voer de correctiecode van deze telefoon in.'
        }
        onCancel={() => {
          setAdminAsk(null);
          setAdminChange(null);
        }}
        onVerified={() => {
          unlockCorrections(id);
          setAdminAsk(null);
          if (adminChange) doAdminChange(adminChange);
          setAdminChange(null);
        }}
        onSet={(record) => {
          setCorrectionPin(id, record);
          unlockCorrections(id);
          setAdminAsk(null);
          if (adminChange) doAdminChange(adminChange);
          setAdminChange(null);
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
