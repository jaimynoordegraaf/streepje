import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, PixelRatio, Pressable, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/text';

import { CartIcon } from '@/components/icons';
import { GuestModal, MemberPickerModal, PromptModal } from '@/components/modals';
import { BottomBar, Button, Card, EmptyState, HeaderButton, Screen } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import { useEventSync, type SyncStatus } from '@/lib/use-sync';
import {
  activePeople,
  eventInvoiceCents,
  eventOutstandingCents,
  eventPaidCents,
  eventTotalCents,
  isSettled,
  paysTonight,
  personItemCount,
  personTotalCents,
} from '@/lib/totals';
import type { ListKind } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

function SummaryCard({
  kind,
  total,
  received,
  outstanding,
  invoiced,
}: {
  kind: ListKind;
  total: number;
  received: number;
  outstanding: number;
  /** What goes onto the treasurer's invoice instead of being paid tonight. */
  invoiced: number;
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

  // Nothing on a tab is paid at the bar, so "received" and "outstanding" would
  // only ever read zero and look as if something were wrong.
  if (kind === 'tab') {
    return (
      <Card style={{ gap: space.xs }}>
        {cell('Totaal', total, theme.text)}
        <Text style={{ color: theme.textDim, fontSize: 13 }}>
          Alles op deze rekening gaat op de factuur van de penningmeester.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ gap: space.sm }}>
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
      {invoiced > 0 ? (
        <Text style={{ color: theme.textDim, fontSize: 13 }}>
          Waarvan {formatCents(invoiced)} op factuur
        </Text>
      ) : null}
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

function Badge({ label, color }: { label: string; color: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: theme.chip,
      }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export default function EventScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const events = useStore((state) => state.events);
  const addPerson = useStore((state) => state.addPerson);
  const addMembers = useStore((state) => state.addMembers);
  const addUnknownPerson = useStore((state) => state.addUnknownPerson);
  const [adding, setAdding] = useState<'name' | 'guest' | 'members' | null>(null);
  const { status, pending, detailsPending } = useEventSync(event);

  // The tabs on this phone, to pick members from. The whole list is selected
  // and filtered here, because a selector that returned a fresh array every
  // time would make the store think something changed on every render.
  const tabs = useMemo(
    () => events.filter((candidate) => candidate.kind === 'tab' && candidate.id !== id),
    [events, id]
  );

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Evenement' }} />
        <EmptyState title="Dit evenement bestaat niet meer" hint="Mogelijk is het verwijderd." />
      </Screen>
    );
  }

  const tab = event.kind === 'tab';
  const people = activePeople(event);
  const nameOf = (personId: string | null) =>
    personId ? (event.people.find((person) => person.id === personId)?.name ?? null) : null;

  // For a sale to someone not on the list: record it now, and work out who it
  // was later by renaming them.
  const addUnknown = () => {
    const personId = addUnknownPerson(id);
    router.push({
      pathname: '/event/[id]/person/[personId]',
      params: { id, personId },
    });
  };

  return (
    <Screen
      footer={
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
      }>
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
        data={people}
        keyExtractor={(person) => person.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.xs }}>
            <SummaryCard
              kind={event.kind}
              total={eventTotalCents(event)}
              received={eventPaidCents(event)}
              outstanding={eventOutstandingCents(event)}
              invoiced={eventInvoiceCents(event)}
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
          tab ? (
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              <Button
                title="Lid toevoegen"
                variant="secondary"
                onPress={() => setAdding('name')}
                style={{ flex: 1 }}
              />
              <Button title="Onbekend" variant="secondary" onPress={addUnknown} style={{ flex: 1 }} />
            </View>
          ) : (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  title="Leden"
                  variant="secondary"
                  onPress={() => setAdding('members')}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Gast"
                  variant="secondary"
                  onPress={() => setAdding('guest')}
                  style={{ flex: 1 }}
                />
              </View>
              <Button title="Onbekend" variant="secondary" onPress={addUnknown} />
            </View>
          )
        }
        ListEmptyComponent={
          <EmptyState
            title={tab ? 'Nog geen leden' : 'Nog niemand toegevoegd'}
            hint={
              tab
                ? 'Voeg de leden van de groep toe en tik daarna op een naam om te turven. Alles gaat op de factuur.'
                : 'Kies leden uit de lopende rekening of voeg een gast toe, en tik daarna op een naam om te turven.'
            }
          />
        }
        renderItem={({ item: person }) => {
          const total = personTotalCents(event, person.id);
          const count = personItemCount(event, person.id);
          const host = nameOf(person.guestOf);
          // On a tab everyone is invoiced, so saying so on every row is noise.
          const invoiced = !tab && !paysTonight(event, person);
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
                      {host ? ' · gast van ' + host : ''}
                    </Text>
                  </View>

                  {invoiced ? (
                    <Badge label="OP FACTUUR" color={theme.link} />
                  ) : isSettled(event, person) ? (
                    <Badge label="BETAALD" color={theme.good} />
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

      <PromptModal
        visible={adding === 'name'}
        title="Lid toevoegen"
        placeholder="Naam"
        submitLabel="Toevoegen"
        onCancel={() => setAdding(null)}
        onSubmit={(name) => {
          addPerson(id, name);
          setAdding(null);
        }}
      />

      <GuestModal
        visible={adding === 'guest'}
        hosts={people.filter((person) => person.memberId !== null)}
        onCancel={() => setAdding(null)}
        onSubmit={(guest) => {
          addPerson(id, guest.name, { billing: guest.billing, guestOf: guest.guestOf });
          setAdding(null);
        }}
      />

      <MemberPickerModal
        visible={adding === 'members'}
        tabs={tabs}
        alreadyIn={event.people.flatMap((person) => (person.memberId ? [person.memberId] : []))}
        onCancel={() => setAdding(null)}
        onSubmit={(members) => {
          addMembers(id, members);
          setAdding(null);
        }}
      />
    </Screen>
  );
}
