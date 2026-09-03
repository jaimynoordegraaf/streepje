import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { Button, Card, EmptyState, Screen, useBottomInset } from '@/components/ui';
import { exportCsv, shareSummary } from '@/lib/export';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import {
  eventOutstandingCents,
  eventPaidCents,
  eventTotalCents,
  personLines,
  personTotalCents,
} from '@/lib/totals';
import { radius, space, useTheme } from '@/theme';

export default function TotalsScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const setPersonPaid = useStore((state) => state.setPersonPaid);
  const [busy, setBusy] = useState(false);
  const bottomInset = useBottomInset();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Totalen' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  const total = eventTotalCents(event);
  const received = eventPaidCents(event);
  const outstanding = eventOutstandingCents(event);

  /** Run an export and turn any failure into a readable message. */
  const runExport = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert('Exporteren mislukt', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const totalRow = (label: string, value: number, color: string, bold = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.textDim, fontSize: 15, fontWeight: bold ? '700' : '500' }}>
        {label}
      </Text>
      <Text style={{ color, fontSize: bold ? 18 : 15, fontWeight: bold ? '800' : '600' }}>
        {formatCents(value)}
      </Text>
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Totalen' }} />

      <FlatList
        data={event.people}
        keyExtractor={(person) => person.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl + bottomInset }}
        ListEmptyComponent={<EmptyState title="Nog niemand in dit evenement" />}
        ListFooterComponent={
          event.people.length > 0 ? (
            <Card style={{ gap: space.sm, marginTop: space.xs }}>
              {totalRow('Ontvangen', received, theme.good)}
              {totalRow('Openstaand', outstanding, outstanding > 0 ? theme.danger : theme.textDim)}
              <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 2 }} />
              {totalRow('Eindtotaal', total, theme.text, true)}

              <View style={{ gap: space.sm, marginTop: space.md }}>
                <Button
                  title={busy ? 'Bezig…' : 'CSV-bestand exporteren'}
                  disabled={busy}
                  onPress={() => runExport(() => exportCsv(event))}
                />
                <Button
                  title="Overzicht delen als tekst"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => runExport(() => shareSummary(event))}
                />
              </View>
            </Card>
          ) : null
        }
        renderItem={({ item: person }) => {
          const lines = personLines(event, person.id);
          const personTotal = personTotalCents(event, person.id);

          return (
            <Card style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: theme.text, fontSize: 17, fontWeight: '700' }}>
                  {person.name}
                </Text>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
                  {formatCents(personTotal)}
                </Text>
              </View>

              {lines.length === 0 ? (
                <Text style={{ color: theme.textDim, fontSize: 13 }}>Niets geturfd</Text>
              ) : (
                lines.map((line) => (
                  <View
                    key={line.item.id}
                    style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.textDim, fontSize: 14 }}>
                      {line.quantity}× {line.item.name}
                      <Text style={{ fontSize: 12 }}> @ {formatCents(line.item.priceCents)}</Text>
                    </Text>
                    <Text style={{ color: theme.textDim, fontSize: 14 }}>
                      {formatCents(line.lineCents)}
                    </Text>
                  </View>
                ))
              )}

              <Pressable
                onPress={() => setPersonPaid(id, person.id, !person.paid)}
                style={({ pressed }) => ({
                  marginTop: space.xs,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: person.paid ? theme.good : theme.chip,
                  opacity: pressed ? 0.75 : 1,
                })}>
                <Text
                  style={{
                    color: person.paid ? theme.onGood : theme.text,
                    fontWeight: '700',
                    fontSize: 14,
                  }}>
                  {person.paid ? 'Betaald ✓  (tik om ongedaan te maken)' : 'Markeer als betaald'}
                </Text>
              </Pressable>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
