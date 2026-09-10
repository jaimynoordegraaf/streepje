import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { CheckIcon } from '@/components/icons';
import { Text } from '@/components/text';
import { BottomBar, Button, Card, EmptyState, Screen, SectionTitle } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import { activeMenu, activePeople } from '@/lib/totals';
import { radius, space, useTheme } from '@/theme';

/**
 * Putting one drink on several people at once.
 *
 * At a bar people buy in rounds, and doing that person by person means leaving
 * and re-entering a screen for every name. Here the item is chosen once and the
 * names are ticked off, which is how the order was given in the first place.
 */
export default function RoundScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const addOrder = useStore((state) => state.addOrder);

  const [itemId, setItemId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Rondje' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  const item = activeMenu(event).find((candidate) => candidate.id === itemId) ?? null;
  const ready = item !== null && chosen.length > 0;

  const toggle = (personId: string) =>
    setChosen((current) =>
      current.includes(personId)
        ? current.filter((each) => each !== personId)
        : [...current, personId]
    );

  const confirm = () => {
    if (!item) return;
    for (const personId of chosen) addOrder(id, personId, item.id, 1);
    router.back();
  };

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            title={
              ready
                ? `${chosen.length}× ${item.name} · ${formatCents(chosen.length * item.priceCents)}`
                : item === null
                  ? 'Kies eerst wat'
                  : 'Kies voor wie'
            }
            disabled={!ready}
            onPress={confirm}
            style={{ flex: 1 }}
          />
        </BottomBar>
      }>
      <Stack.Screen options={{ title: 'Rondje' }} />

      <FlatList
        data={activePeople(event)}
        keyExtractor={(person) => person.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.sm }}>
            <SectionTitle>Wat</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {activeMenu(event).map((candidate) => {
                const active = candidate.id === itemId;
                return (
                  <Pressable
                    key={candidate.id}
                    onPress={() => setItemId(candidate.id)}
                    style={({ pressed }) => ({
                      paddingVertical: space.sm,
                      paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      backgroundColor: active ? theme.accent : theme.chip,
                      opacity: pressed ? 0.7 : 1,
                    })}>
                    <Text
                      style={{
                        color: active ? theme.onAccent : theme.text,
                        fontWeight: '600',
                        fontSize: 14,
                      }}>
                      {candidate.name} · {formatCents(candidate.priceCents)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: space.md,
                gap: space.sm,
              }}>
              <View style={{ flex: 1 }}>
                <SectionTitle>Voor wie</SectionTitle>
              </View>
              <Pressable
                onPress={() =>
                  setChosen(
                    chosen.length === activePeople(event).length
                      ? []
                      : activePeople(event).map((person) => person.id)
                  )
                }
                hitSlop={10}>
                <Text style={{ color: theme.link, fontSize: 14, fontWeight: '600' }}>
                  {chosen.length === activePeople(event).length ? 'Niemand' : 'Iedereen'}
                </Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nog niemand toegevoegd"
            hint="Voeg eerst mensen toe aan dit evenement."
          />
        }
        renderItem={({ item: person }) => {
          const selected = chosen.includes(person.id);
          return (
            <Pressable
              onPress={() => toggle(person.id)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Card
                style={{
                  paddingVertical: space.md,
                  borderColor: selected ? theme.accent : theme.border,
                  borderWidth: selected ? 2 : 1,
                }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 16, fontWeight: '600' }}>
                    {person.name}
                  </Text>
                  {selected ? <CheckIcon size={26} color={theme.accent} /> : null}
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

    </Screen>
  );
}
