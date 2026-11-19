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
import { Alert, Modal, Pressable, ScrollView, SectionList, View } from 'react-native';

import { Choice } from '@/components/modals';
import { Text } from '@/components/text';
import {
  Button,
  Card,
  EmptyState,
  HeaderButton,
  Screen,
  SectionTitle,
  useBottomInset,
} from '@/components/ui';
import { describeError } from '@/lib/errors';
import { exportLogXlsx } from '@/lib/export';
import { buildLogRows, logInvolves, logSummary, type LogRow } from '@/lib/log';
import { formatCents } from '@/lib/money';
import { useEvent } from '@/lib/store';
import { radius, space, useTheme } from '@/theme';

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

/** Kies één persoon om het logboek op te filteren. */
function PersonPicker({
  visible,
  options,
  selected,
  onPick,
  onCancel,
}: {
  visible: boolean;
  options: { id: string; name: string; hint: string }[];
  selected: string | null;
  onPick: (personId: string | null) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  if (!visible) return null;

  const row = (key: string, label: string, hint: string, on: boolean, personId: string | null) => (
    <Pressable
      key={key}
      onPress={() => onPick(personId)}
      style={{
        paddingVertical: 13,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: on ? theme.accent : theme.chip,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: space.sm,
      }}>
      <Text style={{ color: on ? theme.onAccent : theme.text, fontWeight: '600', flexShrink: 1 }}>
        {label}
      </Text>
      <Text style={{ color: on ? theme.onAccent : theme.textDim, fontSize: 12 }}>{hint}</Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.lg }}>
        {/* Een tik op de kaart zelf sluit het venster niet. */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.card,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.md,
            maxHeight: '85%',
            width: '100%',
            maxWidth: 480,
            alignSelf: 'center',
          }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Welke persoon?</Text>
          <ScrollView contentContainerStyle={{ gap: space.sm }}>
            {row('all', 'Alle personen', '', selected === null, null)}
            {options.map((option) => row(option.id, option.name, option.hint, selected === option.id, option.id))}
          </ScrollView>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export default function LogScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; personId?: string }>();
  const { id } = params;
  const event = useEvent(id);
  const bottomInset = useBottomInset();
  const [filter, setFilter] = useState<'alles' | 'correcties'>('alles');
  // Het persoonsscherm opent het logboek met die persoon al gekozen.
  const [who, setWho] = useState<string | null>(params.personId ?? null);
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);

  const rows = useMemo<LogRow[]>(() => (event ? buildLogRows(event) : []), [event]);

  // Een persoon die er niet meer is (bijvoorbeeld na een sync) is geen filter meer.
  const person = who ? event?.people.find((candidate) => candidate.id === who) : undefined;
  const personId = person?.id ?? null;

  const ofPerson = useMemo(
    () => (personId ? rows.filter((row) => logInvolves(row, personId)) : rows),
    [rows, personId]
  );

  const shown =
    filter === 'correcties'
      ? ofPerson.filter((row) => (row.kind === 'turf' ? row.delta < 0 : row.kind !== 'round'))
      : ofPerson;

  const sections = useMemo(() => {
    const groups: { title: string; data: LogRow[] }[] = [];
    for (const row of shown) {
      const title = dayTitle(row.at);
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(row);
      else groups.push({ title, data: [row] });
    }
    return groups;
  }, [shown]);

  const pickerOptions = useMemo(() => {
    if (!event) return [];
    return event.people
      .map((candidate) => {
        const count = rows.filter((row) => logInvolves(row, candidate.id)).length;
        return {
          id: candidate.id,
          name: candidate.name,
          hint: candidate.removedAt ? 'uit de lijst gehaald' : plural(count, 'regel', 'regels'),
        };
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [event, rows]);

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Logboek' }} />
        <EmptyState title="Deze lijst bestaat niet meer" />
      </Screen>
    );
  }

  const corrections = ofPerson.filter((row) => row.kind === 'turf' && row.delta < 0).length;
  const summary = personId ? logSummary(rows, personId) : null;

  /** Altijd het hele logboek: gefilterd wordt in Excel. */
  const runExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportLogXlsx(event);
    } catch (error) {
      Alert.alert('Exporteren mislukt', describeError(error));
    } finally {
      setExporting(false);
    }
  };

  const renderRow = ({ item: row }: { item: LogRow }) => {
    const accent =
      row.kind === 'payment'
        ? theme.good
        : row.kind === 'removed'
          ? theme.danger
          : row.kind === 'round'
            ? theme.text
            : row.delta < 0
              ? theme.danger
              : theme.text;

    const what =
      row.kind === 'turf'
        ? // Een bezoek aan het persoonsscherm is één regel: 3× Bier. Een
          // correctie blijft een min.
          row.delta > 0
          ? `${row.delta}× ${row.item}`
          : `−${Math.abs(row.delta)} ${row.item}`
        : row.kind === 'round'
          ? row.what
          : row.kind === 'payment'
            ? `Betaald ${formatCents(row.cents)}`
            : 'Uit de lijst gehaald';

    const device = row.kind === 'payment' ? null : row.device;
    // Bij een gekozen persoon die het drankje kreeg en niet gaf: van wie.
    const received = row.kind === 'round' && personId !== null && row.personId !== personId;
    const by =
      row.kind === 'payment'
        ? 'Stand van nu, geen geschiedenis'
        : row.kind === 'round'
          ? `${received ? `kreeg van ${row.giver}` : `voor ${row.names}`}${device ? ` · op ${device}` : ''}`
          : device
            ? `op ${device}`
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

  const emptyTitle = person
    ? filter === 'correcties'
      ? `Geen correcties bij ${person.name}`
      : `Niets bij ${person.name}`
    : filter === 'correcties'
      ? 'Geen correcties'
      : 'Nog niets geturfd';

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Logboek',
          // Altijd het hele logboek, ook als hieronder een persoon gekozen is.
          headerRight: () => (
            <HeaderButton title={exporting ? 'Bezig…' : 'Exporteren'} onPress={runExport} />
          ),
        }}
      />

      <SectionList
        sections={sections}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + bottomInset }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.sm }}>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Wat je in één keer op een persoonsscherm streept staat hier als één regel per
              drankje (3× Bier), met de telefoon waarop het is gezet. Een rondje staat als één
              regel. Betalingen en verwijderingen tonen de stand van nu; daarvan bewaart de
              app geen geschiedenis.
            </Text>
            <Choice
              options={[
                { value: 'alles' as const, label: `Alles (${ofPerson.length})` },
                { value: 'correcties' as const, label: `Correcties (${corrections})` },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Pressable
                onPress={() => setPicking(true)}
                accessibilityRole="button"
                accessibilityLabel="Persoon kiezen"
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingVertical: 12,
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  backgroundColor: theme.chip,
                }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '600', flexShrink: 1 }}>
                  Persoon: {person ? person.name : 'Alle personen'}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 13 }}>{person ? 'wijzigen' : 'kiezen'}</Text>
              </Pressable>
              {person ? (
                <Pressable
                  onPress={() => setWho(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Filter op persoon wissen"
                  hitSlop={8}
                  style={{
                    paddingHorizontal: space.md,
                    borderRadius: radius.md,
                    backgroundColor: theme.chip,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>✕</Text>
                </Pressable>
              ) : null}
            </View>
            {person && summary ? (
              <View style={{ backgroundColor: theme.highlight, borderRadius: radius.md, padding: space.md }}>
                <Text style={{ color: theme.onHighlight, fontSize: 13, lineHeight: 19 }}>
                  <Text style={{ fontWeight: '700', color: theme.onHighlight }}>{person.name}</Text>
                  {`: ${plural(summary.turfs, 'turfregel', 'turfregels')}, ${plural(summary.corrections, 'correctie', 'correcties')}, ${plural(summary.gave, 'rondje', 'rondjes')} gegeven, ${plural(summary.received, 'rondje', 'rondjes')} gekregen.`}
                </Text>
              </View>
            ) : null}
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
            title={emptyTitle}
            hint={
              filter === 'correcties'
                ? 'Er is nog niets weggehaald uit deze lijst.'
                : 'Zodra er geturfd wordt, staat het hier.'
            }
          />
        }
      />

      <PersonPicker
        visible={picking}
        options={pickerOptions}
        selected={personId}
        onPick={(next) => {
          setWho(next);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
    </Screen>
  );
}
