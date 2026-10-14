import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { NewListModal } from '@/components/modals';
import { BottomBar, Button, Card, EmptyState, HeaderButton, Screen } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/export';
import { formatCents } from '@/lib/money';
import { newJoinCode, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  attachToGroup,
  fetchGroupSessions,
  fetchSession,
  hostSession,
  joinSession,
  setMemberName,
} from '@/lib/sync';
import {
  activePeople,
  eventInvoiceCents,
  eventOutstandingCents,
  eventTotalCents,
} from '@/lib/totals';
import type { AppEvent } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

function Chip({ label, color }: { label: string; color: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: theme.chip,
      }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

function EventRow({ event, onPress }: { event: AppEvent; onPress: () => void }) {
  const theme = useTheme();
  const tab = event.kind === 'tab';
  const total = eventTotalCents(event);
  const outstanding = eventOutstandingCents(event);
  // "Voldaan" is about money collected at the bar, so only what was owed
  // tonight counts towards it. A list of members has nothing to settle here.
  const owedTonight = total - eventInvoiceCents(event);
  const settled = owedTonight > 0 && outstanding === 0;
  const people = activePeople(event).length;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
              {event.name}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
              {tab ? 'Sinds ' : ''}
              {formatDate(event.createdAt)} · {people}{' '}
              {tab ? (people === 1 ? 'lid' : 'leden') : people === 1 ? 'persoon' : 'personen'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
              {formatCents(total)}
            </Text>
            {tab ? (
              <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>op factuur</Text>
            ) : outstanding > 0 ? (
              <Text style={{ color: theme.danger, fontSize: 13, marginTop: 2 }}>
                {formatCents(outstanding)} open
              </Text>
            ) : settled ? (
              <Text style={{ color: theme.good, fontSize: 13, marginTop: 2 }}>voldaan</Text>
            ) : null}
          </View>
        </View>

        {tab || event.closed ? (
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            {tab ? <Chip label="Lopende rekening" color={theme.link} /> : null}
            {event.closed ? <Chip label="Afgesloten" color={theme.textDim} /> : null}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function EventsScreen() {
  const router = useRouter();
  const events = useStore((state) => state.events);
  const createEvent = useStore((state) => state.createEvent);
  const group = useStore((state) => state.group);
  const adoptRemoteEvent = useStore((state) => state.adoptRemoteEvent);
  const setShare = useStore((state) => state.setShare);
  const setEventGroup = useStore((state) => state.setEventGroup);
  const [creating, setCreating] = useState(false);
  const [fetchingGroup, setFetchingGroup] = useState(false);

  /**
   * Lijsten van de groep ophalen die nog niet op deze telefoon staan.
   *
   * Dit is waar een groep voor is: wie meedoet hoeft niets te scannen als er
   * een nieuwe avond wordt aangemaakt. Stil als er niets te halen valt, en
   * stil als er geen verbinding is -- dan staat er gewoon wat er al stond.
   */
  const syncGroup = useCallback(async () => {
    if (!group || !isSyncConfigured) return;
    setFetchingGroup(true);
    try {
      const known = new Set(useStore.getState().events.map((event) => event.id));
      const deviceName = useStore.getState().deviceName;
      for (const listing of await fetchGroupSessions(group.id)) {
        if (known.has(listing.id)) continue;
        const remote = await fetchSession(listing.id);

        // Ook echt deelnemen aan de lijst, niet alleen meekijken via de groep.
        // Anders staat deze telefoon nergens in de lijst met telefoons, en kan
        // een beheerder hem dus ook niet beheerder maken.
        await joinSession(listing.joinCode).catch(() => {});
        if (deviceName) await setMemberName(listing.id, deviceName).catch(() => {});
        adoptRemoteEvent({
          id: listing.id,
          name: remote.name,
          kind: remote.kind,
          createdAt: remote.createdAt,
          people: remote.people,
          menu: remote.menu,
          entries: remote.entries,
          unsyncedEntryIds: [],
          closed: remote.closed,
          groupId: remote.groupId,
          // De rol wordt bij de eerste synchronisatie door de server bevestigd.
          share: { joinCode: listing.joinCode, role: 'member', lastSyncedAt: Date.now() },
          correctionPin: null,
        });
      }
    } catch {
      // Geen bereik of de server is er even niet. Niets aan de hand: de lijsten
      // die al op deze telefoon staan werken gewoon door.
    } finally {
      setFetchingGroup(false);
    }
  }, [group, adoptRemoteEvent]);

  useFocusEffect(
    useCallback(() => {
      syncGroup();
    }, [syncGroup])
  );

  /**
   * Een nieuwe lijst van iemand uit de barploeg hoort meteen bij de groep.
   *
   * Zonder dit zou elke avond opnieuw gedeeld en gescand moeten worden, en dat
   * is precies waar de groep een eind aan maakt. Lukt het delen niet, dan
   * blijft de lijst gewoon op deze telefoon staan en kan het later alsnog.
   */
  const shareIntoGroup = async (eventId: string) => {
    if (!group || !isSyncConfigured) return;
    const event = useStore.getState().events.find((candidate) => candidate.id === eventId);
    if (!event) return;

    try {
      const { joinCode } = await hostSession(event, newJoinCode());
      setShare(eventId, { joinCode, role: 'admin', lastSyncedAt: Date.now() });
      await attachToGroup(eventId, group.id);
      setEventGroup(eventId, group.id);
    } catch (error) {
      Alert.alert(
        'Niet in de groep gezet',
        describeError(error) +
          '\n\nDe lijst staat wel op deze telefoon. Je kunt hem later alsnog delen via Delen.'
      );
    }
  };

  // The season tab is where most evenings happen, so it sits at the top, and
  // closed events are finished, so they sink to the bottom. Within each group
  // the order is the store's: newest first.
  const ordered = useMemo(
    () => [
      ...events.filter((event) => event.kind === 'tab'),
      ...events.filter((event) => event.kind !== 'tab' && !event.closed),
      ...events.filter((event) => event.kind !== 'tab' && event.closed),
    ],
    [events]
  );

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            title="Deelnemen"
            variant="secondary"
            onPress={() => router.push('/join')}
            style={{ flex: 1 }}
          />
          <Button title="Nieuw" onPress={() => setCreating(true)} style={{ flex: 1 }} />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: 'Evenementen',
          headerRight: () => (
            <HeaderButton title="Instellingen" onPress={() => router.push('/settings')} />
          ),
        }}
      />

      <FlatList
        data={ordered}
        keyExtractor={(event) => event.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        // Naar beneden trekken haalt de lijsten van de groep opnieuw op, voor
        // wie niet wil wachten tot het scherm opnieuw wordt geopend.
        refreshing={fetchingGroup}
        onRefresh={group ? syncGroup : undefined}
        ListEmptyComponent={
          <EmptyState
            title="Nog niets aangemaakt"
            hint="Maak een lopende rekening voor de gewone baravonden, of een evenement voor een feest of een weekend weg, en begin met turven."
          />
        }
        renderItem={({ item }) => (
          <EventRow
            event={item}
            onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } })}
          />
        )}
      />

      <NewListModal
        visible={creating}
        onCancel={() => setCreating(false)}
        onSubmit={(name, kind) => {
          setCreating(false);
          const id = createEvent(name, kind);
          // Zit deze telefoon in een groep, dan hoort de lijst daar meteen bij.
          // Op de achtergrond, zodat het turven niet op de server hoeft te
          // wachten.
          void shareIntoGroup(id);
          router.push({ pathname: '/event/[id]', params: { id } });
        }}
      />
    </Screen>
  );
}
