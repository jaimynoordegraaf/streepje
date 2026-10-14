/**
 * The log: who turfed what, for whom, from which phone, and when.
 *
 * Everything here is read straight from the order log, which is append-only:
 * every tap is its own row and nothing is ever rewritten. That is what makes
 * this trustworthy rather than a summary that could have drifted.
 *
 * Payments and removals are shown too, but they are a different kind of fact.
 * The app stores only their current state -- when someone was marked paid, not
 * every time it changed -- so the screen says so rather than pretending to be
 * a complete history.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';

import { Choice } from '@/components/modals';
import { Text } from '@/components/text';
import { Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent } from '@/lib/store';
import { space, useTheme } from '@/theme';

type Row =
  | { id: string; at: number; kind: 'turf'; person: string; item: string; delta: number; device: string | null }
  | { id: string; at: number; kind: 'payment'; person: string; cents: number }
  | { id: string; at: number; kind: 'removed'; person: string; device: string | null };

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (at: number) => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Written out rather than taken from Intl: the two platforms do not format
// dates identically, and a log that reads differently on the iPhone than on the
// Android phone is a log people stop trusting.
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function dayTitle(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  if (dayKey(at) === dayKey(today.getTime())) return 'Vandaag';
  if (dayKey(at) === dayKey(yesterday.getTime())) return 'Gisteren';

  const base = `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  // The season tab runs for months, so an older year has to be visible.
  return date.getFullYear() === today.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

export default function LogScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const bottomInset = useBottomInset();
  const [filter, setFilter] = useState<'alles' | 'correcties'>('alles');

  const rows = useMemo<Row[]>(() => {
    if (!event) return [];

    const nameOf = (personId: string) =>
      event.people.find((person) => person.id === personId)?.name ?? 'Onbekend';
    const itemOf = (itemId: string) =>
      event.menu.find((item) => item.id === itemId)?.name ?? 'Onbekend item';

    const out: Row[] = event.entries.map((entry) => ({
      id: entry.id,
      at: entry.createdAt,
      kind: 'turf',
      person: nameOf(entry.personId),
      item: itemOf(entry.itemId),
      delta: entry.delta,
      device: entry.deviceName,
    }));

    for (const person of event.people) {
      if (person.paidAt && person.paidCents > 0) {
        out.push({
          id: `paid-${person.id}`,
          at: person.paidAt,
          kind: 'payment',
          person: person.name,
          cents: person.paidCents,
        });
      }
      if (person.removedAt) {
        out.push({
          id: `removed-${person.id}`,
          at: person.removedAt,
          kind: 'removed',
          person: person.name,
          device: person.removedBy,
        });
      }
    }

    return out.sort((a, b) => b.at - a.at);
  }, [event]);

  const shown = filter === 'correcties' ? rows.filter((row) => row.kind !== 'turf' || row.delta < 0) : rows;

  const sections = useMemo(() => {
    const groups: { title: string; data: Row[] }[] = [];
    for (const row of shown) {
      const title = dayTitle(row.at);
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(row);
      else groups.push({ title, data: [row] });
    }
    return groups;
  }, [shown]);

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Logboek' }} />
        <EmptyState title="Deze lijst bestaat niet meer" />
      </Screen>
    );
  }

  const corrections = rows.filter((row) => row.kind === 'turf' && row.delta < 0).length;

  const renderRow = ({ item: row }: { item: Row }) => {
    const accent =
      row.kind === 'payment' ? theme.good : row.kind === 'removed' ? theme.danger : row.delta < 0 ? theme.danger : theme.text;

    const what =
      row.kind === 'turf'
        ? `${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta)} ${row.item}`
        : row.kind === 'payment'
          ? `Betaald ${formatCents(row.cents)}`
          : 'Uit de lijst gehaald';

    const by =
      row.kind === 'payment'
        ? 'Stand van nu, geen geschiedenis'
        : row.device
          ? `op ${row.device}`
          : 'telefoon onbekend';

    return (
      <Card style={{ paddingVertical: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <Text style={{ color: theme.textDim, fontSize: 13, fontVariant: ['tabular-nums'], paddingTop: 2 }}>
            {clock(row.at)}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{row.person}</Text>
            <Text style={{ color: theme.textDim, fontSize: 13 }}>{by}</Text>
          </View>
          <Text style={{ color: accent, fontSize: 15, fontWeight: '700', textAlign: 'right', flexShrink: 1 }}>
            {what}
          </Text>
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Logboek' }} />

      <SectionList
        sections={sections}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + bottomInset }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.sm }}>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Elke tik staat hier apart, met de telefoon waarop hij is gezet. Betalingen en
              verwijderingen tonen de stand van nu; daarvan bewaart de app geen geschiedenis.
            </Text>
            <Choice
              options={[
                { value: 'alles' as const, label: `Alles (${rows.length})` },
                { value: 'correcties' as const, label: `Correcties (${corrections})` },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ marginTop: space.sm }}>
            <SectionTitle>{section.title}</SectionTitle>
          </View>
        )}
        renderItem={renderRow}
        ListEmptyComponent={
          <EmptyState
            title={filter === 'correcties' ? 'Geen correcties' : 'Nog niets geturfd'}
            hint={
              filter === 'correcties'
                ? 'Er is nog niets weggehaald uit deze lijst.'
                : 'Zodra er geturfd wordt, staat het hier.'
            }
          />
        }
      />
    </Screen>
  );
}
