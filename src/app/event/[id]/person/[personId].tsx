import { Stack, useLocalSearchParams } from 'expo-router';
import { SectionList, View } from 'react-native';

import { Text } from '@/components/text';

import { Card, EmptyState, Screen, SectionTitle, StepButton, useBottomInset } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import { personItemCount, personTotalCents, quantities } from '@/lib/totals';
import type { MenuItem } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function PersonScreen() {
  const theme = useTheme();
  const { id, personId } = useLocalSearchParams<{ id: string; personId: string }>();
  const event = useEvent(id);
  const addOrder = useStore((state) => state.addOrder);
  const bottomInset = useBottomInset();

  const person = event?.people.find((candidate) => candidate.id === personId);

  if (!event || !person) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Persoon' }} />
        <EmptyState title="Deze persoon zit niet meer in dit evenement" />
      </Screen>
    );
  }

  // Counted once here rather than per menu row, so the whole screen is one pass.
  const counts = quantities(event, person.id);
  const drinks = event.menu.filter((item) => item.category === 'drink');
  const food = event.menu.filter((item) => item.category === 'food');

  const sections = [
    { title: 'Drankjes', data: drinks },
    { title: 'Eten', data: food },
  ].filter((section) => section.data.length > 0);

  const renderItem = ({ item }: { item: MenuItem }) => {
    const quantity = Math.max(0, counts[item.id] ?? 0);
    return (
      <Card style={{ paddingVertical: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
              {formatCents(item.priceCents)}
              {quantity > 0 ? ` · ${formatCents(quantity * item.priceCents)}` : ''}
            </Text>
          </View>

          <StepButton
            label="−"
            onPress={() => addOrder(id, person.id, item.id, -1)}
            disabled={quantity === 0}
          />
          <Text
            style={{
              color: quantity > 0 ? theme.text : theme.textDim,
              fontSize: 20,
              fontWeight: '700',
              minWidth: 32,
              textAlign: 'center',
            }}>
            {quantity}
          </Text>
          <StepButton
            label="+"
            tone="accent"
            onPress={() => addOrder(id, person.id, item.id, 1)}
          />
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: person.name }} />

      {/* Running total, always visible while tapping. */}
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          backgroundColor: theme.card,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}>
        <Text style={{ color: theme.textDim, fontSize: 14 }}>
          {personItemCount(event, person.id)} consumpties
        </Text>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>
          {formatCents(personTotalCents(event, person.id))}
        </Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + bottomInset }}
        renderSectionHeader={({ section }) => (
          <View style={{ marginTop: space.sm }}>
            <SectionTitle>{section.title}</SectionTitle>
          </View>
        )}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            title="Dit evenement heeft nog geen menu"
            hint="Open Beheer bij het evenement om drankjes en eten toe te voegen."
          />
        }
      />
    </Screen>
  );
}
