import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { Button, Card, EmptyState, Screen, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { PromptModal } from '@/components/modals';
import { exportCsv, formatDateTime, sharePersonRequest, shareSummary } from '@/lib/export';
import { parsePrice } from '@/lib/money';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import type { Person } from '@/lib/types';
import {
  activePeople,
  removedPeople,
  correctionCount,
  corrections,
  deviceLabel,
  isSettled,
  personOutstandingCents,
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
  const setPersonPayment = useStore((state) => state.setPersonPayment);
  const [payingPerson, setPayingPerson] = useState<Person | null>(null);
  const deviceId = useStore((state) => state.deviceId);
  const deviceName = useStore((state) => state.deviceName);
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
      Alert.alert('Exporteren mislukt', describeError(error));
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
        data={activePeople(event)}
        keyExtractor={(person) => person.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl + bottomInset }}
        ListEmptyComponent={<EmptyState title="Nog niemand in dit evenement" />}
        ListFooterComponent={
          activePeople(event).length > 0 || removedPeople(event).length > 0 ? (
            <>
            {removedPeople(event).length > 0 ? (
              <Card style={{ gap: space.sm, marginBottom: space.md }}>
                <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>
                  VERWIJDERDE PERSONEN
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>
                  Hun turfjes tellen niet meer mee, maar blijven hier zichtbaar.
                </Text>
                {removedPeople(event).map((person) => (
                  <View key={person.id} style={{ gap: 2, marginTop: space.xs }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                        {person.name}
                      </Text>
                      <Text style={{ color: theme.textDim, fontSize: 14 }}>
                        {formatCents(personTotalCents(event, person.id))}
                      </Text>
                    </View>
                    <Text style={{ color: theme.textDim, fontSize: 12 }}>
                      {person.removedAt ? formatDateTime(person.removedAt) : ''}
                      {person.removedBy ? ` · ${person.removedBy}` : ''}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}

            <Card style={{ gap: space.sm, marginTop: space.xs }}>
              {totalRow('Ontvangen', received, theme.good)}
              {totalRow('Openstaand', outstanding, outstanding > 0 ? theme.danger : theme.textDim)}
              <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 2 }} />
              {totalRow('Eindtotaal', total, theme.text, true)}

              {correctionCount(event) > 0 ? (
                <Text style={{ color: theme.danger, fontSize: 13, marginTop: space.xs }}>
                  {correctionCount(event)}{' '}
                  {correctionCount(event) === 1 ? 'turfje is' : 'turfjes zijn'} weggehaald tijdens
                  dit evenement.
                </Text>
              ) : null}

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
            </>
          ) : null
        }
        renderItem={({ item: person }) => {
          const lines = personLines(event, person.id);
          const personTotal = personTotalCents(event, person.id);
          const removed = corrections(event, person.id);
          const settled = isSettled(event, person);
          const outstanding = personOutstandingCents(event, person);

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

              {removed.length > 0 ? (
                <View
                  style={{
                    gap: 2,
                    marginTop: space.xs,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                  }}>
                  <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>
                    WEGGEHAALD
                  </Text>
                  {removed.map((entry) => (
                    <Text key={entry.id} style={{ color: theme.textDim, fontSize: 12 }}>
                      {formatDateTime(entry.createdAt)} · {-entry.delta}×{' '}
                      {event.menu.find((item) => item.id === entry.itemId)?.name ?? 'onbekend'} ·{' '}
                      {deviceLabel(entry, { deviceId, deviceName })}
                    </Text>
                  ))}
                </View>
              ) : null}

              {person.paidCents > 0 && !settled ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.good, fontSize: 13, fontWeight: '600' }}>
                    {formatCents(person.paidCents)} betaald
                  </Text>
                  <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>
                    {formatCents(outstanding)} open
                  </Text>
                </View>
              ) : null}

              <Pressable
                onPress={() =>
                  setPersonPayment(id, person.id, settled ? 0 : personTotal)
                }
                style={({ pressed }) => ({
                  marginTop: space.xs,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: settled ? theme.good : theme.chip,
                  opacity: pressed ? 0.75 : 1,
                })}>
                <Text
                  style={{
                    color: settled ? theme.onGood : theme.text,
                    fontWeight: '700',
                    fontSize: 14,
                  }}>
                  {settled ? 'Betaald ✓  (tik om ongedaan te maken)' : 'Markeer als betaald'}
                </Text>
              </Pressable>

              {!settled ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button
                    title="Deelbetaling"
                    variant="secondary"
                    onPress={() => setPayingPerson(person)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Vraag betaling"
                    variant="secondary"
                    onPress={() => sharePersonRequest(event, person).catch(() => {})}
                    style={{ flex: 1 }}
                  />
                </View>
              ) : null}
            </Card>
          );
        }}
      />

      <PromptModal
        visible={payingPerson !== null}
        title={payingPerson ? `Betaling van ${payingPerson.name}` : 'Betaling'}
        placeholder="Bedrag, bijv. 10,00"
        submitLabel="Vastleggen"
        onCancel={() => setPayingPerson(null)}
        onSubmit={(value) => {
          const amount = parsePrice(value);
          if (payingPerson && amount !== null) {
            // Added to what was already handed over, since a part payment
            // follows an earlier one rather than replacing it.
            setPersonPayment(id, payingPerson.id, payingPerson.paidCents + amount);
          }
          setPayingPerson(null);
        }}
      />
    </Screen>
  );
}
