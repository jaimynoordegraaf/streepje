/**
 * Eén lijst, vanaf het Groep-scherm: bekijken, ophalen, bijwerken, beheerders
 * en verwijderen.
 *
 * Dit was het Delen-scherm. De QR en de code per lijst zijn weg: meedoen gaat
 * via de groep. Wat er van delen overbleef, staat hier:
 *
 * - **Ophalen**: een lijst van de groep die nog niet op dit toestel staat.
 * - **Bijwerken**: de nieuwste stand van de server op dit toestel zetten. Dat
 *   haalt alleen op. Namen, prijzen, betalingen en afgesloten gaan niet de
 *   andere kant op, zodat een toestel dat lang niet open was niets van een
 *   ander ongedaan kan maken. Alleen turven die hier nog wachten gaan mee; die
 *   worden op de server alleen toegevoegd.
 * - **Beheerders van deze lijst**: wie mag corrigeren, met de correctiecode,
 *   zoals het was.
 * - **Verwijderen, voor iedereen**: een beheerder van deze lijst (met zijn
 *   correctiecode) of een groepsbeheerder (met de groepsbeheercode). De
 *   database controleert dat zelf (delete_session, 009 en 022).
 *
 * Het scherm werkt ook voor een lijst die nog niet op dit toestel staat (dan
 * komt wat er te zien is van de server), en voor een lijst die van de server
 * verwijderd is (dan is dit de eigen kopie van dit toestel).
 */

import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { useGroupPinGate } from '@/components/group-pin';
import { whenAlertClosed } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Text } from '@/components/text';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/export';
import { groupErrorText, listPlace, placeLabel } from '@/lib/group-lists';
import { formatCents } from '@/lib/money';
import { correctionsUnlocked, isAdminDevice, unlockCorrections } from '@/lib/pin';
import { timeAgo } from '@/lib/share-status';
import { useEvent, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  addAdmin,
  deleteSharedSession,
  fetchGroupMembers,
  fetchGroupSession,
  fetchSession,
  myUserId,
  pushEntries,
  removeAdmin,
  SessionGoneError,
  type GroupSession,
} from '@/lib/sync';
import { activePeople, eventTotalCents } from '@/lib/totals';
import type { SessionMember } from '@/lib/types';
import { fetchIntoDevice, putIntoGroup } from '@/lib/use-group-sync';
import { useSessionMembers } from '@/lib/use-sync';
import { radius, space, useTheme } from '@/theme';

const errorText = (error: unknown) => {
  const message = describeError(error);
  return groupErrorText(message) ?? message;
};

function Pill({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'good' | 'bad' }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: tone === 'bad' ? 'transparent' : theme.chip,
        borderWidth: tone === 'bad' ? 1 : 0,
        borderColor: theme.danger,
      }}>
      <Text
        style={{
          color: tone === 'good' ? theme.good : tone === 'bad' ? theme.danger : theme.text,
          fontSize: 12,
          fontWeight: '700',
        }}>
        {label}
      </Text>
    </View>
  );
}

/** Wat er onder een knop staat om uit te leggen wat hij doet. */
function Hint({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Text style={{ color: danger ? theme.danger : theme.textDim, fontSize: 12, lineHeight: 17 }}>
      {children}
    </Text>
  );
}

export default function GroupListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const group = useStore((state) => state.group);
  const deleteEvent = useStore((state) => state.deleteEvent);
  const pullRemote = useStore((state) => state.pullRemote);
  const markEntriesSynced = useStore((state) => state.markEntriesSynced);
  const dropEntries = useStore((state) => state.dropEntries);
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const bottomInset = useBottomInset();
  const { members, admins, meId, reload } = useSessionMembers(event);
  const groupPin = useGroupPinGate('Lijst verwijderen');

  // undefined: nog niet gevraagd of geen verbinding. null: de server heeft hem niet.
  const [remote, setRemote] = useState<GroupSession | null | undefined>(undefined);
  const [amGroupAdmin, setAmGroupAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  // Wat er na de correctiecode van deze lijst moet gebeuren.
  const [listAsk, setListAsk] = useState<{ mode: 'verify' | 'set'; then: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!isSyncConfigured || !id) return;
    try {
      const [listing, groupMembers, me] = await Promise.all([
        fetchGroupSession(id),
        group ? fetchGroupMembers(group.id) : Promise.resolve([]),
        myUserId(),
      ]);
      setRemote(listing);
      setAmGroupAdmin(groupMembers.some((member) => member.userId === me && member.admin));
      setOffline(false);
    } catch {
      // Geen verbinding: het scherm laat zien wat dit toestel zelf weet.
      setOffline(true);
    }
  }, [id, group]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (title: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert(title, errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /** Achter de correctiecode van deze lijst, zoals elk weghalen. */
  const withListPin = (then: () => void) => {
    if (!event || correctionsUnlocked(event.id)) return then();
    setListAsk({ mode: event.correctionPin ? 'verify' : 'set', then });
  };

  const here = Boolean(event);
  const shared = Boolean(event?.share);
  const gone = here && shared && remote === null;
  const place = event ? listPlace(event, group?.id ?? null) : 'group';
  const listAdmin = event ? shared && isAdminDevice(event) : false;
  const inThisGroup = event ? Boolean(group) && event.groupId === group?.id : Boolean(remote);
  const onServer = here ? shared && !gone : Boolean(remote);
  const canDelete = onServer && (listAdmin || (amGroupAdmin && inThisGroup));

  if (!event && remote === null) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Lijst' }} />
        <EmptyState title="Deze lijst bestaat niet meer" />
      </Screen>
    );
  }

  if (!event && !remote) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Lijst' }} />
        <View style={{ padding: space.xl, alignItems: 'center', gap: space.md }}>
          {offline ? null : <ActivityIndicator color={theme.accent} />}
          <Text style={{ color: theme.textDim, textAlign: 'center' }}>
            {offline
              ? 'Deze lijst staat nog niet op dit toestel, en zonder verbinding is hij niet op te halen.'
              : 'Deze lijst staat nog niet op dit toestel. Ophalen van de server…'}
          </Text>
          {offline ? <Button title="Opnieuw proberen" variant="secondary" onPress={load} /> : null}
        </View>
      </Screen>
    );
  }

  const title = event?.name || remote?.name || 'Lopende rekening';
  const closed = event?.closed ?? remote?.closed ?? false;
  const tab = (event?.kind ?? remote?.kind) === 'tab';

  // --------------------------------------------------------------- acties ---

  const doPull = () =>
    run('Bijwerken mislukt', async () => {
      if (!event) return;
      const before = event.entries.length;
      // Eerst wat hier wacht: dat wordt op de server alleen toegevoegd.
      const queued = new Set(event.unsyncedEntryIds);
      const rows = event.entries.filter((entry) => queued.has(entry.id));
      if (rows.length > 0) {
        const refused = await pushEntries(event.id, rows);
        const dropped = new Set(refused);
        markEntriesSynced(event.id, rows.map((row) => row.id).filter((entryId) => !dropped.has(entryId)));
        dropEntries(event.id, refused);
      }
      try {
        const fresh = await fetchSession(event.id);
        pullRemote(event.id, fresh, isAdminDevice(event));
      } catch (error) {
        if (error instanceof SessionGoneError) {
          setRemote(null);
          throw new Error('Deze lijst staat niet meer op de server. Wat hier staat is de eigen kopie van dit toestel.');
        }
        throw error;
      }
      const after = useStore.getState().events.find((candidate) => candidate.id === event.id);
      const added = Math.max(0, (after?.entries.length ?? before) - before);
      Alert.alert(
        'Bijgewerkt',
        `${added === 0 ? 'Geen nieuwe turven.' : added === 1 ? '1 nieuwe turf.' : `${added} nieuwe turven.`}${
          rows.length > 0 ? ` ${rows.length} wachtende turven van dit toestel zijn verstuurd.` : ''
        } ${
          isAdminDevice(event)
            ? 'Namen, prijzen en betalingen van dit toestel zijn blijven staan: dit is een beheertelefoon.'
            : 'Namen, prijzen en betalingen zijn alleen opgehaald, niet verstuurd.'
        }`
      );
    });

  const doFetch = () =>
    run('Ophalen mislukt', async () => {
      if (remote) await fetchIntoDevice(remote);
    });

  const doPutIn = () => {
    if (!event || !group) return;
    Alert.alert(
      `${title} in de groep zetten?`,
      event.share
        ? `Deze lijst staat al op de server, want hij is vroeger met een losse code gedeeld. Hij komt nu bij ${group.name}. Er wordt niets overschreven: alleen de groep wordt erbij gezet. Dit kan één keer.`
        : `De lijst gaat naar de server en is daarna te zien voor iedereen in ${group.name}. Er staat nog niets van op de server, dus er wordt niets overschreven. Dit kan één keer.`,
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Zet in de groep',
          onPress: () =>
            run('Niet in de groep gezet', async () => {
              try {
                await putIntoGroup(event.id);
              } catch (error) {
                throw new Error(
                  `${errorText(error)}\n\nDe lijst wacht nu, en gaat vanzelf de groep in zodra er verbinding is.`
                );
              }
              await load();
            }),
        },
      ]
    );
  };

  const doDelete = () =>
    run('Verwijderen mislukt', async () => {
      await deleteSharedSession(id);
      if (event) deleteEvent(id);
      router.back();
    });

  const confirmDelete = () =>
    Alert.alert(
      `${title} verwijderen?`,
      'Alle namen en turven worden van de server gewist, voor iedereen in de groep, en de lijst gaat van dit toestel af. Op andere toestellen waar hij al staat blijft een eigen kopie staan, die niet meer wordt bijgewerkt. Exporteer eerst als de penningmeester hem nog nodig heeft.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          // Een beheerder van de lijst met de code van de lijst, zoals altijd;
          // anders een groepsbeheerder met de groepsbeheercode.
          onPress: () => whenAlertClosed(() => (listAdmin ? withListPin(doDelete) : groupPin.gate(doDelete))),
        },
      ]
    );

  const removeHere = () => {
    if (!event) return;
    const last = gone || !shared;
    // Turven die nog niet verstuurd zijn, staan alleen hier. Ook bij een lijst
    // die verder gewoon op de server staat, gaan die met het weghalen verloren.
    const waiting = event.unsyncedEntryIds.length;
    const lost =
      waiting === 0
        ? ''
        : `\n\nLet op: ${waiting === 1 ? '1 turf is' : `${waiting} turven zijn`} nog niet verstuurd en ${
            waiting === 1 ? 'staat' : 'staan'
          } alleen op dit toestel. Die ${waiting === 1 ? 'is' : 'zijn'} daarna weg.`;
    Alert.alert(
      `${title} van dit toestel halen?`,
      (last
        ? 'Dit is de laatste kopie: hij staat niet (meer) op de server. Alles wat erin geturfd is, is daarna weg. Exporteer eerst als je de gegevens nog nodig hebt.'
        : 'De lijst blijft op de server en bij de anderen staan. Je kunt hem hier later weer ophalen via Groep.') +
        lost,
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Weghalen',
          style: 'destructive',
          onPress: () => {
            const go = () => {
              deleteEvent(event.id);
              router.back();
            };
            // Wie beheerder is en turven weggooit die nergens anders staan, haalt
            // geld weg: met de code.
            if ((last || waiting > 0) && isAdminDevice(event)) whenAlertClosed(() => withListPin(go));
            else go();
          },
        },
      ]
    );
  };

  const adminChange = (member: SessionMember, make: boolean) => {
    const self = member.userId === meId;
    const name = self ? 'Dit toestel' : (member.name ?? 'Naamloos toestel');
    Alert.alert(
      make ? `${name} beheerder van deze lijst maken?` : `${name} geen beheerder meer?`,
      make
        ? 'Dat toestel kan daarna in deze lijst turven en mensen weghalen, betalingen vastleggen, het menu en de prijzen aanpassen en zelf beheerders aanwijzen. Hij kiest daarvoor zijn eigen correctiecode.\n\nLet op: een beheertelefoon die lang niet open was, kan bij het openen zijn oude stand meesturen. Maak alleen een toestel beheerder dat regelmatig open is.'
        : self
          ? 'Dit toestel kan daarna niets meer corrigeren. Alleen een andere beheerder kan dat terugdraaien.'
          : 'Dat toestel kan daarna alleen nog turven.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: make ? 'Beheerder maken' : 'Intrekken',
          style: make ? 'default' : 'destructive',
          onPress: () =>
            whenAlertClosed(() =>
              withListPin(() =>
                run('Beheerders wijzigen mislukt', async () => {
                  try {
                    if (make) await addAdmin(id, member.userId);
                    else await removeAdmin(id, member.userId);
                  } catch (error) {
                    const message = describeError(error);
                    if (message.includes('at least one admin')) throw new Error('Een lijst houdt altijd minstens één beheerder.');
                    if (message.includes('has not joined')) throw new Error('Dat toestel doet niet meer mee aan deze lijst.');
                    throw error;
                  } finally {
                    reload();
                  }
                })
              )
            ),
        },
      ]
    );
  };

  // --------------------------------------------------------------- scherm ---

  const lastSynced = event?.share?.lastSyncedAt ?? null;
  const pending = event?.unsyncedEntryIds.length ?? 0;

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <Card style={{ gap: space.sm }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Pill label={closed ? 'Afgesloten' : tab ? 'Lopende rekening' : 'Open'} tone={closed ? 'plain' : 'good'} />
            {gone ? (
              <Pill label="Niet meer op de server" tone="bad" />
            ) : event ? (
              <Pill label={placeLabel(place)} />
            ) : (
              <Pill label="Nog niet op dit toestel" />
            )}
            {event && shared && !gone ? (
              <Pill label={lastSynced ? `Laatst verbonden ${timeAgo(lastSynced, Date.now())}` : 'Nog nooit verbonden'} />
            ) : null}
            {event && shared && pending > 0 ? <Pill label={`${pending} nog te versturen`} /> : null}
            {listAdmin ? <Pill label="Beheerder van deze lijst" /> : null}
          </View>
          {event ? (
            <Text style={{ color: theme.textDim, fontSize: 13 }}>
              {tab ? 'Sinds ' : ''}
              {formatDate(event.createdAt)} · {activePeople(event).length}{' '}
              {tab ? 'leden' : 'personen'} · {formatCents(eventTotalCents(event))}
            </Text>
          ) : remote ? (
            <Text style={{ color: theme.textDim, fontSize: 13 }}>
              {tab ? 'Sinds ' : 'Gemaakt '}
              {formatDate(remote.createdAt)}
            </Text>
          ) : null}
        </Card>

        <View style={{ gap: space.sm }}>
          {event ? (
            <Button
              title="Openen"
              onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}
            />
          ) : (
            <>
              <Button title={busy ? 'Bezig…' : 'Ophalen naar dit toestel'} disabled={busy} onPress={doFetch} />
              <Hint>Daarna staat hij hier en werkt hij als elke andere lijst.</Hint>
            </>
          )}

          {event && shared && !gone && isSyncConfigured ? (
            <>
              <Button title={busy ? 'Bezig…' : 'Bijwerken'} variant="secondary" disabled={busy} onPress={doPull} />
              <Hint>
                Haalt de nieuwste stand van de server op. Er gaat niets van dit toestel overheen,
                behalve turven die hier nog wachten.
              </Hint>
            </>
          ) : null}

          {event && group && (place === 'local' || place === 'code' || place === 'pending') && isAdminDevice(event) ? (
            <>
              <Button title={busy ? 'Bezig…' : 'Zet in de groep'} variant="secondary" disabled={busy} onPress={doPutIn} />
              <Hint>
                {place === 'pending'
                  ? 'Wacht op verbinding. Dit probeert het nu meteen opnieuw.'
                  : `Daarna zien de anderen in ${group.name} hem ook.`}
              </Hint>
            </>
          ) : null}
          {event && group && place === 'code' && !isAdminDevice(event) ? (
            <Hint>
              Deze lijst is met een losse code gedeeld. Alleen een beheerder van de lijst kan hem in de
              groep zetten.
            </Hint>
          ) : null}
          {gone ? (
            <Hint danger>
              Deze lijst is van de server verwijderd. Wat hier staat is de eigen kopie van dit toestel;
              die wordt niet meer bijgewerkt.
            </Hint>
          ) : null}
        </View>

        {event && shared && !gone ? (
          <View style={{ gap: space.sm }}>
            <SectionTitle>Toestellen in deze lijst</SectionTitle>
            <Card style={{ gap: space.md }}>
              {members.length === 0 ? (
                <Text style={{ color: theme.textDim, fontSize: 14 }}>Niet op te halen zonder verbinding.</Text>
              ) : (
                members.map((member) => {
                  const memberIsAdmin = admins.includes(member.userId);
                  const lastAdmin = memberIsAdmin && admins.length === 1;
                  return (
                    <View key={member.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
                          {member.name ?? 'Naamloos toestel'}
                          {member.userId === meId ? ' (dit toestel)' : ''}
                        </Text>
                        <Text
                          style={{
                            color: memberIsAdmin ? theme.good : theme.textDim,
                            fontSize: 12,
                            fontWeight: memberIsAdmin ? '700' : '400',
                          }}>
                          {memberIsAdmin ? 'Beheerder: corrigeert en legt betalingen vast' : 'Turft mee'}
                        </Text>
                      </View>
                      {listAdmin && !lastAdmin ? (
                        <Pressable onPress={() => adminChange(member, !memberIsAdmin)} disabled={busy} hitSlop={8}>
                          <Text style={{ color: memberIsAdmin ? theme.danger : theme.link, fontWeight: '600' }}>
                            {memberIsAdmin ? 'Intrekken' : 'Maak beheerder'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })
              )}
            </Card>
            {listAdmin && admins.length === 1 ? (
              <Hint danger>
                Er is maar één beheertelefoon voor deze lijst. Raakt die kwijt, dan kan niemand de lijst
                nog corrigeren. Een groepsbeheerder kan hem wel verwijderen.
              </Hint>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          {canDelete ? (
            <>
              <Button
                title={busy ? 'Bezig…' : 'Lijst verwijderen, voor iedereen'}
                variant="danger"
                disabled={busy}
                onPress={confirmDelete}
              />
              <Hint>
                {listAdmin
                  ? 'Vraagt de correctiecode van deze lijst.'
                  : 'Dit toestel is groepsbeheerder. Vraagt de groepsbeheercode van dit toestel.'}
              </Hint>
            </>
          ) : onServer && inThisGroup ? (
            <Hint>
              Alleen een beheerder van deze lijst of een groepsbeheerder kan hem verwijderen.
            </Hint>
          ) : null}

          {event && (gone || (closed && shared) || place === 'other') ? (
            <Button title="Van dit toestel halen" variant="danger" disabled={busy} onPress={removeHere} />
          ) : null}
        </View>
      </ScrollView>

      {event ? (
        <PinModal
          visible={listAsk !== null}
          mode={listAsk?.mode ?? 'verify'}
          eventId={event.id}
          record={event.correctionPin}
          title={title}
          explanation={
            listAsk?.mode === 'set'
              ? 'Deze lijst heeft op dit toestel nog geen correctiecode. Kies er een; die is vanaf nu nodig om te corrigeren, beheerders te wijzigen en te verwijderen.'
              : 'Voer de correctiecode van deze lijst in.'
          }
          onCancel={() => setListAsk(null)}
          onVerified={() => {
            unlockCorrections(event.id);
            const then = listAsk?.then;
            setListAsk(null);
            then?.();
          }}
          onSet={(record) => {
            setCorrectionPin(event.id, record);
            unlockCorrections(event.id);
            const then = listAsk?.then;
            setListAsk(null);
            then?.();
          }}
        />
      ) : null}

      {groupPin.modal}
    </Screen>
  );
}
