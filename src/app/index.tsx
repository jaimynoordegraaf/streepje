import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { NewListModal } from '@/components/modals';
import { BottomBar, Button, Card, EmptyState, HeaderButton, Screen } from '@/components/ui';
import { formatDate } from '@/lib/export';
import { formatCents } from '@/lib/money';
import { useStore } from '@/lib/store';
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
  const [creating, setCreating] = useState(false);

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
          router.push({ pathname: '/event/[id]', params: { id } });
        }}
      />
    </Screen>
  );
}
