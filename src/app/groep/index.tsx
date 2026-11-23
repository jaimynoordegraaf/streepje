/**
 * Het Groep-scherm: de basis van streepje.
 *
 * Een toestel doet één keer mee met de groepscode, en alle lijsten horen
 * daarbij. Delen per lijst met een eigen code bestaat niet meer als begrip; wat
 * daarvan nog toe doet, staat hier en op het scherm van één lijst
 * (groep/[id].tsx). Op één plek:
 *
 * - de naam en de code van de groep, met de QR om mee te doen;
 * - wie er meedoet en wie groepsbeheerder is;
 * - alle lijsten van de groep, ook die nog niet op dit toestel staan;
 * - de lijsten op dit toestel die nog niet in de groep zitten, met "Zet in de groep".
 *
 * Het staat onder Beheer, dus achter de beheercode. Wat een groepsbeheerder
 * hier extra doet (beheerders aanwijzen) vraagt daarbovenop de
 * groepsbeheercode van dit toestel; zie group-pin.tsx.
 */

import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Children, useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useGroupPinGate } from '@/components/group-pin';
import { PromptModal, whenAlertClosed } from '@/components/modals';
import { Text } from '@/components/text';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { groupErrorText, groupJoinUrl, listPlace, listStatusLine } from '@/lib/group-lists';
import { isAdminDevice } from '@/lib/pin';
import { newId, newJoinCode, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  addGroupAdmin,
  createGroup,
  fetchGroupMembers,
  fetchGroupSessions,
  leaveGroup,
  leaveSession,
  myUserId,
  removeGroupAdmin,
  setGroupMemberName,
  type GroupMember,
  type GroupSession,
} from '@/lib/sync';
import { fetchIntoDevice, putIntoGroup } from '@/lib/use-group-sync';
import type { AppEvent } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

const errorText = (error: unknown) => {
  const message = describeError(error);
  return groupErrorText(message) ?? message;
};

function Row({
  title,
  line,
  onPress,
  right,
}: {
  title: string;
  line?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? theme.chip : 'transparent',
      })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {line ? (
          <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>{line}</Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Text style={{ color: theme.textDim, fontSize: 20 }}>›</Text> : null)}
    </Pressable>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  return (
    <View
      style={{
        backgroundColor: theme.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
      }}>
      {rows.map((child, index) => (
        <View
          key={index}
          style={{ borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.border }}>
          {child}
        </View>
      ))}
    </View>
  );
}

function SmallButton({ title, onPress, tone = 'link' }: { title: string; onPress: () => void; tone?: 'link' | 'danger' }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={{ color: tone === 'danger' ? theme.danger : theme.link, fontWeight: '700', fontSize: 14 }}>
        {title}
      </Text>
    </Pressable>
  );
}

export default function GroupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ maken?: string }>();
  const group = useStore((state) => state.group);
  const events = useStore((state) => state.events);
  const deviceName = useStore((state) => state.deviceName);
  const setGroup = useStore((state) => state.setGroup);
  const setShare = useStore((state) => state.setShare);
  const bottomInset = useBottomInset();
  const pin = useGroupPinGate('Groepsbeheerders');

  const [makingGroup, setMakingGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [loading, setLoading] = useState(false);
  // Null zolang de server niet geantwoord heeft: dan weten we het niet, en is
  // "deze lijst is weg" dus ook niet te zeggen.
  const [listings, setListings] = useState<GroupSession[] | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [meId, setMeId] = useState<string | null>(null);

  // Vanaf het welkomstscherm: meteen de naam vragen.
  useEffect(() => {
    if (params.maken && !group) setMakingGroup(true);
  }, [params.maken, group]);

  const load = useCallback(async () => {
    if (!group || !isSyncConfigured) return;
    setLoading(true);
    try {
      if (deviceName) await setGroupMemberName(group.id, deviceName).catch(() => {});
      const [nextListings, nextMembers, me] = await Promise.all([
        fetchGroupSessions(group.id),
        fetchGroupMembers(group.id),
        myUserId(),
      ]);
      setListings(nextListings);
      setMembers(nextMembers);
      setMeId(me);
    } catch {
      // Geen verbinding: het scherm laat zien wat dit toestel zelf weet.
    } finally {
      setLoading(false);
    }
  }, [group, deviceName]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Rond een actie af en maak van een mislukking een leesbare melding. */
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

  const amAdmin = members.some((member) => member.userId === meId && member.admin);
  const adminCount = members.filter((member) => member.admin).length;

  const confirmAdmin = (member: GroupMember, make: boolean) => {
    const self = member.userId === meId;
    const name = self ? 'Dit toestel' : (member.name ?? 'Toestel zonder naam');
    Alert.alert(
      make ? `${name} groepsbeheerder maken?` : `${name} geen groepsbeheerder meer?`,
      make
        ? 'Een groepsbeheerder kan de ledenlijst aanpassen, lijsten van de groep verwijderen en zelf groepsbeheerders aanwijzen. Turven weghalen en betalingen vastleggen blijft per lijst bij de beheertelefoons van die lijst.'
        : self
          ? 'Dit toestel kan daarna de ledenlijst niet meer aanpassen en geen lijsten van de groep meer verwijderen. Alleen een andere groepsbeheerder kan dat terugdraaien.'
          : 'Dat toestel doet daarna gewoon mee, zonder beheer van de groep.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: make ? 'Groepsbeheerder maken' : 'Intrekken',
          style: make ? 'default' : 'destructive',
          onPress: () =>
            whenAlertClosed(() =>
              pin.gate(() =>
                run('Groepsbeheerders wijzigen mislukt', async () => {
                  if (!group) return;
                  if (make) await addGroupAdmin(group.id, member.userId);
                  else await removeGroupAdmin(group.id, member.userId);
                  await load();
                })
              )
            ),
        },
      ]
    );
  };

  /**
   * De groep verlaten, en dan ook echt los zijn.
   *
   * Een toestel dat lijsten van de groep ophaalt, meldt zich daar ook bij aan.
   * Blijft die aanmelding staan, dan houdt het toegang via een achterdeur. Dus
   * bij het verlaten gaan die aanmeldingen er ook af. Wat al geturfd is blijft in
   * de lijsten staan; dat is van de lijst, niet van het toestel.
   */
  const confirmLeaveGroup = () => {
    if (!group) return;
    Alert.alert(
      `${group.name} verlaten?`,
      'Dit toestel loopt daarna niet meer mee met de lijsten van de groep. Ze blijven als eigen kopie staan, maar worden niet meer bijgewerkt. Wat er geturfd is blijft in de lijsten staan en de andere toestellen merken er niets van.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verlaten',
          style: 'destructive',
          onPress: () =>
            run('Groep verlaten mislukt', async () => {
              // Eerst de groep: weigert de server (laatste groepsbeheerder), dan
              // blijft alles zoals het was.
              await leaveGroup(group.id);
              for (const event of useStore.getState().events) {
                if (event.groupId !== group.id || !event.share) continue;
                // Best effort: de laatste beheerder van een lijst mag niet weg,
                // en zonder bereik lukt het ook niet.
                await leaveSession(event.id).catch(() => {});
                setShare(event.id, null);
              }
              setGroup(null);
              setListings(null);
              setMembers([]);
            }),
        },
      ]
    );
  };

  const putIn = (event: AppEvent) => {
    if (!group) return;
    Alert.alert(
      `${event.name || 'Deze lijst'} in de groep zetten?`,
      event.share
        ? `Deze lijst staat al op de server, want hij is vroeger met een losse code gedeeld. Hij komt nu bij ${group.name}, zodat iedereen in de groep hem ziet. Er wordt niets overschreven: alleen de groep wordt erbij gezet. Dit kan één keer.`
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

  if (!isSyncConfigured) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Groep' }} />
        <EmptyState title="Groepen zijn hier niet beschikbaar" />
      </Screen>
    );
  }

  const now = Date.now();
  const real = events.filter((event) => !event.demo);
  const local = new Map(real.map((event) => [event.id, event]));
  const inGroup = group ? real.filter((event) => event.groupId === group.id) : [];
  const onServer = new Set((listings ?? []).map((listing) => listing.id));
  // Op de server, nog niet hier.
  const remoteOnly = (listings ?? []).filter((listing) => !local.has(listing.id));
  // Hier in de groep, maar de server kent hem niet meer: verwijderd.
  const gone = listings ? inGroup.filter((event) => !onServer.has(event.id)) : [];
  const groupHere = inGroup.filter((event) => !gone.includes(event));
  const outside = real.filter((event) => !group || listPlace(event, group.id) !== 'group');

  const open = (id: string) => router.push({ pathname: '/groep/[id]', params: { id } });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Groep' }} />

      <ScrollView
        refreshControl={
          group ? <RefreshControl refreshing={loading} onRefresh={load} /> : undefined
        }
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        {group ? (
          <>
            <Card style={{ gap: space.sm }}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{group.name}</Text>
              <Text style={{ color: theme.textDim, fontSize: 13 }}>
                Groepscode, voor wie er nog bij moet
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.text, fontSize: 28, fontWeight: '700', letterSpacing: 5 }}>
                  {group.joinCode}
                </Text>
                <SmallButton title={showQr ? 'QR verbergen' : 'QR tonen'} onPress={() => setShowQr(!showQr)} />
              </View>
              {showQr ? (
                <View style={{ alignItems: 'center', gap: space.sm }}>
                  <View style={{ backgroundColor: '#FFFFFF', padding: space.md, borderRadius: radius.md }}>
                    <QRCode value={groupJoinUrl(group.joinCode)} size={200} />
                  </View>
                  <Text style={{ color: theme.textDim, fontSize: 12, textAlign: 'center' }}>
                    Scan op het andere toestel bij Beheer › Groep › Meedoen.
                  </Text>
                </View>
              ) : null}
            </Card>

            <View style={{ gap: space.sm }}>
              <SectionTitle>Wie doet mee</SectionTitle>
              {members.length === 0 ? (
                <Text style={{ color: theme.textDim, fontSize: 13 }}>
                  {loading ? 'Ophalen…' : 'Niet op te halen zonder verbinding.'}
                </Text>
              ) : (
                <Box>
                  {members.map((member) => {
                    const self = member.userId === meId;
                    const lastAdmin = member.admin && adminCount <= 1;
                    return (
                      <Row
                        key={member.userId}
                        title={`${member.name ?? 'Toestel zonder naam'}${self ? ' (dit toestel)' : ''}`}
                        line={
                          member.admin
                            ? 'Groepsbeheerder'
                            : member.name
                              ? 'Doet mee'
                              : 'Doet mee · heeft de nieuwe versie nog niet geopend'
                        }
                        right={
                          amAdmin && !lastAdmin ? (
                            <SmallButton
                              title={member.admin ? 'Intrekken' : 'Maak beheerder'}
                              tone={member.admin ? 'danger' : 'link'}
                              onPress={() => confirmAdmin(member, !member.admin)}
                            />
                          ) : undefined
                        }
                      />
                    );
                  })}
                </Box>
              )}
              <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
                Een groepsbeheerder beheert de ledenlijst en kan lijsten van de groep verwijderen.
                Turven weghalen en betalingen vastleggen gaat per lijst, door de beheertelefoons van
                die lijst.
              </Text>
            </View>

            <View style={{ gap: space.sm }}>
              <SectionTitle>Lijsten van de groep</SectionTitle>
              {groupHere.length + remoteOnly.length === 0 ? (
                <Text style={{ color: theme.textDim, fontSize: 13 }}>
                  {loading ? 'Ophalen…' : 'Nog geen lijsten in de groep.'}
                </Text>
              ) : (
                <Box>
                  {groupHere.map((event) => (
                    <Row
                      key={event.id}
                      title={event.name || 'Lopende rekening'}
                      line={listStatusLine(event, group.id, now)}
                      onPress={() => open(event.id)}
                    />
                  ))}
                  {remoteOnly.map((listing) => (
                    <Row
                      key={listing.id}
                      title={listing.name || 'Lopende rekening'}
                      line={`${listing.closed ? 'Afgesloten · ' : ''}Staat nog niet op dit toestel`}
                      onPress={() => open(listing.id)}
                      right={
                        <SmallButton
                          title="Ophalen"
                          onPress={() =>
                            run('Ophalen mislukt', async () => {
                              await fetchIntoDevice(listing);
                            })
                          }
                        />
                      }
                    />
                  ))}
                </Box>
              )}
            </View>

            {gone.length > 0 ? (
              <View style={{ gap: space.sm }}>
                <SectionTitle>Verwijderd uit de groep</SectionTitle>
                <Box>
                  {gone.map((event) => (
                    <Row
                      key={event.id}
                      title={event.name || 'Lopende rekening'}
                      line="Staat niet meer op de server; dit is de eigen kopie van dit toestel"
                      onPress={() => open(event.id)}
                    />
                  ))}
                </Box>
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ gap: space.sm }}>
            <SectionTitle>Groep</SectionTitle>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              De barploeg werkt in één groep: één code, één keer scannen. Daarna horen alle lijsten
              bij de groep en verschijnen ze vanzelf op elk toestel. Corrigeren en betalingen
              blijven voorbehouden aan beheertelefoons.
            </Text>
            <Button
              title="Meedoen met een groepscode"
              disabled={busy}
              onPress={() => router.push('/groep/meedoen')}
            />
            <Button
              title="Groep maken"
              variant="secondary"
              disabled={busy}
              onPress={() => setMakingGroup(true)}
            />
            <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
              Eén toestel maakt de groep en laat de anderen de QR scannen. Iedereen met de code kan
              alle lijsten van de groep zien en erin turven.
            </Text>
          </View>
        )}

        {outside.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionTitle>{group ? 'Alleen op dit toestel' : 'Lijsten op dit toestel'}</SectionTitle>
            <Box>
              {outside.map((event) => {
                const place = group ? listPlace(event, group.id) : null;
                const canPut =
                  group && (place === 'local' || place === 'code') && isAdminDevice(event);
                return (
                  <Row
                    key={event.id}
                    title={event.name || 'Lopende rekening'}
                    line={listStatusLine(event, group?.id ?? null, now)}
                    onPress={() => open(event.id)}
                    right={
                      canPut ? (
                        <SmallButton title="Zet in de groep" onPress={() => putIn(event)} />
                      ) : place === 'pending' ? (
                        <SmallButton title="Opnieuw" onPress={() => putIn(event)} />
                      ) : undefined
                    }
                  />
                );
              })}
            </Box>
            {group ? (
              <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
                De anderen in de groep zien deze lijsten niet.
                {outside.some((event) => listPlace(event, group.id) === 'code' && !isAdminDevice(event))
                  ? ' Een lijst die met een losse code gedeeld is en waar dit toestel geen beheerder van is, kan alleen zijn beheerder in de groep zetten.'
                  : ''}
              </Text>
            ) : null}
          </View>
        ) : null}

        {group ? (
          <Button
            title={busy ? 'Bezig…' : 'Groep verlaten'}
            variant="danger"
            disabled={busy}
            onPress={confirmLeaveGroup}
          />
        ) : null}
      </ScrollView>

      <PromptModal
        visible={makingGroup}
        title="Groep maken"
        placeholder="Naam, bijv. Barploeg JWF"
        submitLabel="Aanmaken"
        onCancel={() => setMakingGroup(false)}
        onSubmit={(name) => {
          setMakingGroup(false);
          const trimmed = name.trim();
          if (trimmed === '') return;
          run('Groep maken mislukt', async () => {
            const made = await createGroup(newId(), trimmed, newJoinCode());
            setGroup(made);
            const name = useStore.getState().deviceName;
            if (name) await setGroupMemberName(made.id, name).catch(() => {});
            setShowQr(true);
            await load();
          });
        }}
      />

      {pin.modal}
    </Screen>
  );
}
