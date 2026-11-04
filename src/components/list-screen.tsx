/**
 * Eén lijst: de namen, de totalen en de knoppen om te turven.
 *
 * Staat op twee plekken. Op het beginscherm (`app/index.tsx`) als de lopende
 * rekening waar de app mee opent, en op `event/[id]` voor elke lijst die je
 * vanuit het overzicht opent. Dezelfde inhoud, dus één component.
 *
 * Alles wat geen turven is zit achter het menu in de kop (zie menu.tsx).
 */

import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, PixelRatio, Pressable, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/text';

import { CartIcon } from '@/components/icons';
import {
  DropdownMenu,
  MenuButton,
  useDropdown,
  useGlobalItems,
  type DropdownItem,
} from '@/components/menu';
import { GuestModal, MemberPickerModal, PromptModal } from '@/components/modals';
import { useNewList } from '@/components/new-list';
import { TourTarget } from '@/components/tour';
import { BottomBar, Button, Card, EmptyState, Screen } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useStore } from '@/lib/store';
import { ANCHOR } from '@/lib/tour';
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

/**
 * Hoe het delen er voor staat, als regel tekst en als "hier moet je naar
 * kijken".
 *
 * Dit stond als balk midden in de lijst. Nu staat de regel onder Delen in het
 * menu, en `problem` zet een puntje op de drie puntjes: een lijst die niet
 * meer synchroniseert mag niet pas opvallen als iemand het menu opent.
 */
function shareState(
  shared: boolean,
  status: SyncStatus,
  pending: number,
  unsaved: boolean
): { label: string; problem: boolean } {
  if (!shared) return { label: 'Alleen op deze telefoon', problem: false };
  if (unsaved) return { label: 'Wijziging nog niet opgeslagen', problem: true };
  if (status === 'live') return { label: 'Verbonden met de andere telefoons', problem: false };
  if (status === 'connecting') return { label: 'Verbinden…', problem: false };
  if (status === 'offline') return { label: 'Offline · ' + pending + ' nog te versturen', problem: true };
  return { label: 'Gedeeld', problem: false };
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

export function ListScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const event = useEvent(id);
  const events = useStore((state) => state.events);
  const addPerson = useStore((state) => state.addPerson);
  const addMembers = useStore((state) => state.addMembers);
  const addUnknownPerson = useStore((state) => state.addUnknownPerson);
  const setHomeTab = useStore((state) => state.setHomeTab);
  const [adding, setAdding] = useState<'name' | 'guest' | 'members' | null>(null);
  const { status, pending, detailsPending } = useEventSync(event);
  const menu = useDropdown();
  const newList = useNewList();
  const globalItems = useGlobalItems(newList.start);

  // De lopende rekening die je opent is de volgende keer waar de app mee
  // opent. De voorbeeldlijst van de rondleiding is geen rekening en telt niet.
  const opensHome = event?.kind === 'tab' && !event.demo;
  useEffect(() => {
    if (opensHome) setHomeTab(id);
  }, [opensHome, id, setHomeTab]);

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

  const sharing = shareState(Boolean(event.share), status, pending, detailsPending);

  // Wat niet turven is, in de volgorde waarin je het zoekt: eerst wat bij
  // déze lijst hoort, dan wat voor de hele telefoon geldt.
  const items: DropdownItem[] = [
    {
      label: event.share ? 'Delen beheren' : 'Delen',
      hint: sharing.label,
      onPress: () => router.push({ pathname: '/event/[id]/share', params: { id } }),
    },
    {
      label: 'Beheer',
      onPress: () => router.push({ pathname: '/event/[id]/setup', params: { id } }),
    },
    {
      label: 'Logboek',
      onPress: () => router.push({ pathname: '/event/[id]/log', params: { id } }),
    },
    ...globalItems,
  ];

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            title="Rondje"
            tourId={ANCHOR.round}
            variant="secondary"
            disabled={event.closed}
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
            <MenuButton onOpen={menu.open} alert={sharing.problem} tourId={ANCHOR.menu} />
          ),
        }}
      />

      <DropdownMenu top={menu.top} items={items} onClose={menu.close} />
      {newList.modal}

      <FlatList
        data={people}
        keyExtractor={(person) => person.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.xs }}>
            {event.closed ? (
              <Card style={{ gap: space.xs, borderColor: theme.textDim }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>Afgesloten</Text>
                <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
                  Er kan niet meer geturfd worden. Betalingen en exporteren via Totalen blijven werken.
                </Text>
              </Card>
            ) : null}
            <SummaryCard
              kind={event.kind}
              total={eventTotalCents(event)}
              received={eventPaidCents(event)}
              outstanding={eventOutstandingCents(event)}
              invoiced={eventInvoiceCents(event)}
            />
          </View>
        }
        ListFooterComponent={
          event.closed ? null : tab ? (
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
              event.closed
                ? undefined
                : tab
                ? 'Voeg de leden van de groep toe en tik daarna op een naam om te turven. Alles gaat op de factuur.'
                : 'Kies leden uit de lopende rekening of voeg een gast toe, en tik daarna op een naam om te turven.'
            }
          />
        }
        renderItem={({ item: person, index }) => {
          const total = personTotalCents(event, person.id);
          const count = personItemCount(event, person.id);
          const host = nameOf(person.guestOf);
          // On a tab everyone is invoiced, so saying so on every row is noise.
          const invoiced = !tab && !paysTonight(event, person);
          const row = (
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
                      {person.note ? ' · ' + person.note : ''}
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
          // De rondleiding wijst de bovenste naam aan om turven op te laten zien.
          return index === 0 ? <TourTarget id={ANCHOR.person}>{row}</TourTarget> : row;
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
          addPerson(id, guest.name, {
            billing: guest.billing,
            guestOf: guest.guestOf,
            note: guest.note,
          });
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
