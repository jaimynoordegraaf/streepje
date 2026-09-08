import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, PixelRatio, Pressable, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/text';

import { CartIcon } from '@/components/icons';
import { PromptModal } from '@/components/modals';
import { BottomBar, Button, Card, EmptyState, HeaderButton, Screen } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import { useEventSync, type SyncStatus } from '@/lib/use-sync';
import {
  eventOutstandingCents,
  eventPaidCents,
  eventTotalCents,
  isSettled,
  personItemCount,
  personTotalCents,
} from '@/lib/totals';
import { radius, space, useTheme } from '@/theme';

function SummaryCard({
  total,
  received,
  outstanding,
}: {
  total: number;
  received: number;
  outstanding: number;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  /**
   * Three columns only survive while the words fit in a third of the card.
   * With the phone's text size turned up, or on a narrow screen, "Openstaand"
   * is wider than its column and gets broken mid-word into "Openstaan / d".
   * Stacking into rows costs a little height and always reads correctly.
   */
  const stacked = PixelRatio.getFontScale() > 1.15 || width < 360;

  const cell = (label: string, value: number, color: string) =>
    stacked ? (
      <View
        key={label}
        style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm }}>
        <Text style={{ color: theme.textDim, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{formatCents(value)}</Text>
      </View>
    ) : (
      <View key={label} style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{formatCents(value)}</Text>
      </View>
    );

  return (
    <Card>
      <View
        style={
          stacked
            ? { gap: space.sm }
            : { flexDirection: 'row', gap: space.sm }
        }>
        {cell('Totaal', total, theme.text)}
        {cell('Ontvangen', received, theme.good)}
        {cell('Openstaand', outstanding, outstanding > 0 ? theme.danger : theme.textDim)}
      </View>
    </Card>
  );
}

function ShareStrip({
  status,
  pending,
  unsaved,
  shared,
  onPress,
}: {
  status: SyncStatus;
  pending: number;
  /** An edit this phone is holding that the server has not accepted yet. */
  unsaved: boolean;
  shared: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  const label = !shared
    ? 'Alleen op deze telefoon'
    : unsaved
      ? 'Wijziging nog niet opgeslagen'
    : status === 'live'
      ? 'Verbonden met de andere telefoons'
      : status === 'connecting'
        ? 'Verbinden…'
        : status === 'offline'
          ? 'Offline · ' + pending + ' nog te versturen'
          : 'Gedeeld';

  const dot = !shared
    ? theme.textDim
    : unsaved
      ? theme.danger
    : status === 'live'
      ? theme.good
      : status === 'offline'
        ? theme.danger
        : theme.highlight;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card style={{ paddingVertical: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} />
          <Text style={{ flex: 1, color: theme.textDim, fontSize: 14 }}>{label}</Text>
          <Text style={{ color: theme.link, fontSize: 14, fontWeight: '600' }}>
            {shared ? 'Beheren' : 'Delen'}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function EventScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const addPerson = useStore((state) => state.addPerson);
  const addUnknownPerson = useStore((state) => state.addUnknownPerson);
  const [prompting, setPrompting] = useState(false);
  const { status, pending, detailsPending } = useEventSync(event);

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Evenement' }} />
        <EmptyState title="Dit evenement bestaat niet meer" hint="Mogelijk is het verwijderd." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: event.name,
          headerRight: () => (
            <HeaderButton
              title="Beheer"
              onPress={() => router.push({ pathname: '/event/[id]/setup', params: { id } })}
            />
          ),
        }}
      />

      <FlatList
        data={event.people}
        keyExtractor={(person) => person.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.xs }}>
            <SummaryCard
              total={eventTotalCents(event)}
              received={eventPaidCents(event)}
              outstanding={eventOutstandingCents(event)}
            />
            <ShareStrip
              status={status}
              pending={pending}
              unsaved={detailsPending}
              shared={Boolean(event.share)}
              onPress={() => router.push({ pathname: '/event/[id]/share', params: { id } })}
            />
          </View>
        }
        ListFooterComponent={
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button
              title="Persoon toevoegen"
              variant="secondary"
              onPress={() => setPrompting(true)}
              style={{ flex: 1 }}
            />
            <Button
              title="Onbekend"
              variant="secondary"
              onPress={() => {
                // For a sale to someone not on the list: record it now, work
                // out who it was later by renaming them.
                const personId = addUnknownPerson(id);
                router.push({
                  pathname: '/event/[id]/person/[personId]',
                  params: { id, personId },
                });
              }}
              style={{ flex: 1 }}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nog niemand toegevoegd"
            hint="Voeg de mensen toe die meedoen en tik daarna op een naam om hun drankjes en eten te turven."
          />
        }
        renderItem={({ item: person }) => {
          const total = personTotalCents(event, person.id);
          const count = personItemCount(event, person.id);
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/event/[id]/person/[personId]',
                  params: { id, personId: person.id },
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
                      {person.name}
                    </Text>
                    <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
                      {count} {count === 1 ? 'consumptie' : 'consumpties'}
                    </Text>
                  </View>

                  {isSettled(event, person) ? (
                    <View
                      style={{
                        paddingHorizontal: space.sm,
                        paddingVertical: 3,
                        borderRadius: radius.pill,
                        backgroundColor: theme.chip,
                      }}>
                      <Text style={{ color: theme.good, fontSize: 12, fontWeight: '700' }}>
                        BETAALD
                      </Text>
                    </View>
                  ) : null}

                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
                    {formatCents(total)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      <BottomBar>
        <Button
          title="Rondje"
          variant="secondary"
          onPress={() => router.push({ pathname: '/event/[id]/round', params: { id } })}
          style={{ flex: 1 }}
        />
        <Button
          title="Totalen"
          icon={(color, size) => <CartIcon size={size} color={color} />}
          onPress={() => router.push({ pathname: '/event/[id]/totals', params: { id } })}
          style={{ flex: 1 }}
        />
      </BottomBar>

      <PromptModal
        visible={prompting}
        title="Persoon toevoegen"
        placeholder="Naam"
        submitLabel="Toevoegen"
        onCancel={() => setPrompting(false)}
        onSubmit={(name) => {
          addPerson(id, name);
          setPrompting(false);
        }}
      />
    </Screen>
  );
}
