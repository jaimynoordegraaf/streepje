import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { useNewList } from '@/components/new-list';
import { TourTarget } from '@/components/tour';
import { BottomBar, Button, Card, EmptyState, HeaderButton, Screen } from '@/components/ui';
import { formatDate } from '@/lib/export';
import { formatCents } from '@/lib/money';
import { useStore } from '@/lib/store';
import { ANCHOR } from '@/lib/tour';
import { useGroupSync } from '@/lib/use-group-sync';
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

/**
 * Alle lijsten op deze telefoon: de lopende rekeningen en de evenementen.
 *
 * Geen beginscherm meer maar een plek om naartoe te gaan, via het menu. De app
 * opent in de lopende rekening (zie app/index.tsx); hier kies je een andere
 * lijst, of maak of open je er een.
 */
export default function ListsScreen() {
  const router = useRouter();
  const events = useStore((state) => state.events);
  const newList = useNewList();
  // Hier komt de groep ook binnen: de lijsten van de barploeg die nog niet op
  // deze telefoon staan, en naar beneden trekken haalt ze opnieuw op.
  const { group, fetching, syncGroup } = useGroupSync(true);

  // The season tab is where most evenings happen, so it sits at the top, and
  // closed events are finished, so they sink to the bottom. Within each group
  // the order is the store's: newest first. De voorbeeldlijst van de
  // rondleiding gaat voor alles, anders staat hij bij veel lijsten buiten
  // beeld op het moment dat de rondleiding ernaar wijst.
  const ordered = useMemo(
    () => [
      ...events.filter((event) => event.demo),
      ...events.filter((event) => event.kind === 'tab'),
      ...events.filter((event) => event.kind !== 'tab' && !event.closed && !event.demo),
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
          <Button title="Nieuw" onPress={newList.start} style={{ flex: 1 }} />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: 'Alle lijsten',
          headerRight: () => (
            <HeaderButton title="Instellingen" onPress={() => router.push('/settings')} />
          ),
        }}
      />

      <FlatList
        data={ordered}
        keyExtractor={(event) => event.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        refreshing={fetching}
        onRefresh={group ? syncGroup : undefined}
        ListEmptyComponent={
          <EmptyState
            title="Nog niets aangemaakt"
            hint="Maak een lopende rekening voor de gewone baravonden, of een evenement voor een feest of een weekend weg, en begin met turven."
          />
        }
        renderItem={({ item }) => {
          const row = (
            <EventRow
              event={item}
              onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } })}
            />
          );
          // De rondleiding wijst de voorbeeldlijst aan. Op de voorbeeldlijst
          // zelf en niet op de bovenste rij: de eigen lijsten van deze
          // telefoon staan ook in dit overzicht.
          return item.demo ? <TourTarget id={ANCHOR.list}>{row}</TourTarget> : row;
        }}
      />

      {newList.modal}
    </Screen>
  );
}
