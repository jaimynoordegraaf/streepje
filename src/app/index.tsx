import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { PromptModal } from '@/components/modals';
import { BottomBar, Button, Card, EmptyState, HeaderButton, Screen } from '@/components/ui';
import { formatDate } from '@/lib/export';
import { formatCents } from '@/lib/money';
import { useStore } from '@/lib/store';
import { eventOutstandingCents, eventTotalCents } from '@/lib/totals';
import type { AppEvent } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

function EventRow({ event, onPress }: { event: AppEvent; onPress: () => void }) {
  const theme = useTheme();
  const total = eventTotalCents(event);
  const outstanding = eventOutstandingCents(event);
  const settled = total > 0 && outstanding === 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
              {event.name}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
              {formatDate(event.createdAt)} · {event.people.length}{' '}
              {event.people.length === 1 ? 'persoon' : 'personen'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
              {formatCents(total)}
            </Text>
            {outstanding > 0 ? (
              <Text style={{ color: theme.danger, fontSize: 13, marginTop: 2 }}>
                {formatCents(outstanding)} open
              </Text>
            ) : settled ? (
              <Text style={{ color: theme.good, fontSize: 13, marginTop: 2 }}>voldaan</Text>
            ) : null}
          </View>
        </View>

        {event.closed ? (
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: space.md,
              paddingHorizontal: space.sm,
              paddingVertical: 3,
              borderRadius: radius.pill,
              backgroundColor: theme.chip,
            }}>
            <Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '600' }}>Afgesloten</Text>
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
  const [prompting, setPrompting] = useState(false);

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
          <Button title="Nieuw evenement" onPress={() => setPrompting(true)} style={{ flex: 1 }} />
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
        data={events}
        keyExtractor={(event) => event.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        ListEmptyComponent={
          <EmptyState
            title="Nog geen evenementen"
            hint="Maak er een aan voor een feest, een weekend weg of een avond in de bar en begin met turven."
          />
        }
        renderItem={({ item }) => (
          <EventRow
            event={item}
            onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } })}
          />
        )}
      />

      <PromptModal
        visible={prompting}
        title="Nieuw evenement"
        placeholder="bijv. BBQ bij Sam's"
        submitLabel="Aanmaken"
        onCancel={() => setPrompting(false)}
        onSubmit={(name) => {
          setPrompting(false);
          const id = createEvent(name);
          router.push({ pathname: '/event/[id]', params: { id } });
        }}
      />
    </Screen>
  );
}
