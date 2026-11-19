/**
 * Eén lijst: de namen, de totalen en de knoppen om te turven.
 *
 * Staat op twee plekken. Op het beginscherm (`app/index.tsx`) als de lopende
 * rekening waar de app mee opent, en op `event/[id]` voor elke lijst die je
 * vanuit het overzicht opent. Dezelfde inhoud, dus één component.
 *
 * Alles wat geen turven is zit achter het menu in de kop (zie menu.tsx): wat de
 * barploeg af en toe nodig heeft bovenaan, de rest achter de beheercode. Op het
 * scherm zelf staat alleen de lijst en onderin Tegelijk turven en Rondje.
 */

import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, PixelRatio, Pressable, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/text';

import {
  DropdownMenu,
  MenuButton,
  useDropdown,
  type DropdownItem,
} from '@/components/menu';
import { BellIcon } from '@/components/bell';
import { GuestModal, MemberPickerModal } from '@/components/modals';
import { NameSuggestModal, type NameCandidate } from '@/components/name-suggest';
import { askAboutSameName } from '@/components/same-name';
import { Tally } from '@/components/tally';
import { TourTarget } from '@/components/tour';
import { BottomBar, Button, Card, EmptyState, Screen } from '@/components/ui';
import { guestsOf, guestsUnderHosts } from '@/lib/guests';
import { formatCents } from '@/lib/money';
import { findSameName, nameKey } from '@/lib/names';
import { useWithPending } from '@/lib/pending';
import { useEvent, useStore } from '@/lib/store';
import { ANCHOR } from '@/lib/tour';
import { useListOrder } from '@/lib/use-list-order';
import { useRoster } from '@/lib/use-roster';
import { useEventSync, type SyncStatus } from '@/lib/use-sync';
import {
  eventInvoiceCents,
  eventOutstandingCents,
  eventPaidCents,
  eventTotalCents,
  isSettled,
  paysTonight,
  personItemCount,
  personTotalCents,
} from '@/lib/totals';
import type { ListKind, Person } from '@/lib/types';
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
  // Met wat er nog wacht om teruggenomen te worden erbij, voor de aantallen en
  // bedragen op dit scherm. Wat vaststaat blijft `event`.
  const withWaiting = useWithPending(event);
  const events = useStore((state) => state.events);
  const addPerson = useStore((state) => state.addPerson);
  const addMembers = useStore((state) => state.addMembers);
  const addRosterPeople = useStore((state) => state.addRosterPeople);
  const addDefaultPerson = useStore((state) => state.addDefaultPerson);
  const defaultPeople = useStore((state) => state.defaultPeople);
  const localSections = useStore((state) => state.sections);
  const { roster } = useRoster();
  const setHomeTab = useStore((state) => state.setHomeTab);
  const display = useStore((state) => state.display);
  const [adding, setAdding] = useState<'name' | 'guest' | 'members' | null>(null);
  const { status, pending, detailsPending } = useEventSync(event);
  const menu = useDropdown();
  // Eerst wie dit seizoen streepjes heeft, op alfabet, dan de rest. Bepaald als
  // de lijst opent en vast tijdens het turven (zie use-list-order.ts).
  const ordered = useListOrder(event, true);

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

  const counted = withWaiting ?? event;
  const tab = event.kind === 'tab';
  // Op een rekening staat een gast direct onder zijn lid, op de volgorde hierboven.
  const people = guestsUnderHosts(event, ordered);
  const isGuestRow = (person: Person) =>
    tab && person.guestOf !== null && people.some((other) => other.id === person.guestOf);
  const nameOf = (personId: string | null) =>
    personId ? (event.people.find((person) => person.id === personId)?.name ?? null) : null;

  const sharing = shareState(Boolean(event.share), status, pending, detailsPending);

  // De namen waaruit Lid toevoegen voorstellen doet. Zit de telefoon in een groep
  // met een ledenlijst, dan komen ze daaruit; anders uit de Vaste namen van dit
  // toestel. Wie al op deze lijst staat (of eerder is verwijderd) staat er ook
  // tussen, maar is grijs: zo zie je waarom je niet nog een Jan krijgt.
  const rosterMembers = roster ? roster.members.filter((member) => member.removedAt === null) : [];
  const fromRoster = rosterMembers.length > 0;
  const sectionLabel = (sectionId: string | null | undefined) =>
    (fromRoster ? roster?.sections : localSections)?.find((section) => section.id === sectionId)?.name ?? null;
  const blockedLabel = (id: string, name: string): string | null => {
    const same = event.people.find(
      (person) => person.rosterId === id || nameKey(person.name) === nameKey(name)
    );
    if (!same) return null;
    return same.removedAt === null ? 'staat al op de lijst' : 'eerder verwijderd';
  };
  const nameCandidates: NameCandidate[] = (() => {
    const source: NameCandidate[] = fromRoster
      ? rosterMembers.map((member) => ({
          id: member.id,
          name: member.name,
          section: sectionLabel(member.sectionId),
          blocked: blockedLabel(member.id, member.name),
        }))
      : defaultPeople.map((saved) => ({
          id: saved.id,
          name: saved.name,
          section: sectionLabel(saved.sectionId),
          blocked: blockedLabel(saved.id, saved.name),
        }));
    const known = new Set(source.map((candidate) => nameKey(candidate.name)));
    // Wie op de lijst staat maar in de bron ontbreekt, ook als voorstel (grijs).
    const onList: NameCandidate[] = event.people
      .filter((person) => !known.has(nameKey(person.name)))
      .map((person) => ({
        id: person.id,
        name: person.name,
        section: null,
        blocked: person.removedAt === null ? 'staat al op de lijst' : 'eerder verwijderd',
      }));
    return [...source, ...onList];
  })();

  // Staat de naam er al, dan eerst vragen. De vraag komt als het venster dicht is.
  const addUnlessSame = (name: string, add: () => void) => {
    const match = findSameName(event, name);
    if (!match) return add();
    askAboutSameName({
      match,
      proceedLabel: 'Toch toevoegen',
      onProceed: add,
      onGoTo: (person) =>
        router.push({
          pathname: '/event/[id]/person/[personId]',
          params: { id, personId: person.id },
        }),
    });
  };

  // Wat niet turven is, in twee blokken. Eerst wat de barploeg af en toe nodig
  // heeft: namen erbij zetten. Dat stond onder de lijst, maar wordt bijna niet
  // gebruikt en nam daar plek in. Daaronder wat geld of instellingen raakt, en
  // dat vraagt de beheercode. Op een afgesloten lijst kan er niemand bij.
  const adders: DropdownItem[] = event.closed
    ? []
    : tab
    ? [
        { label: 'Lid toevoegen', onPress: () => setAdding('name') },
        { label: 'Gast', onPress: () => setAdding('guest') },
      ]
    : [
        { label: 'Leden', onPress: () => setAdding('members') },
        { label: 'Gast', onPress: () => setAdding('guest') },
      ];

  const items: DropdownItem[] = [
    ...adders.map((item, index) => (index === 0 ? { ...item, heading: 'Voor de bar' } : item)),
    {
      // Alles achter de beheercode staat op één pagina. Het rode puntje op de
      // drie puntjes (sharing.problem) heeft daarmee geen eigen uitleg meer in
      // het menu, dus die komt hier als regel onder Beheer.
      label: 'Beheer',
      hint: sharing.problem ? sharing.label : undefined,
      hintAlert: sharing.problem,
      heading: 'Achter de beheercode',
      onPress: () => router.push({ pathname: '/event/[id]/beheer', params: { id } }),
      locked: true,
    },
  ];

  return (
    <Screen
      footer={
        <BottomBar>
          {/* Eén vlak voor de rondleiding, zodat hij naar de twee knoppen
              samen kan wijzen. */}
          <TourTarget id={ANCHOR.round} style={{ flex: 1, flexDirection: 'row', gap: space.sm }}>
            <Button
              title="Tegelijk turven"
              variant="secondary"
              disabled={event.closed}
              onPress={() => router.push({ pathname: '/event/[id]/tegelijk', params: { id } })}
              style={{ flex: 1 }}
            />
            <Button
              title="Rondje"
              icon={(color, size) => <BellIcon size={size} color={color} />}
              disabled={event.closed}
              onPress={() => router.push({ pathname: '/event/[id]/rondje', params: { id } })}
              style={{ flex: 1 }}
            />
          </TourTarget>
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
            {/* Op papier stond er geen totaal bij de streepjes. Het staat nog
                onder Totalen. */}
            {display !== 'bedragen' ? null : (
              <SummaryCard
                kind={event.kind}
                total={eventTotalCents(counted)}
                received={eventPaidCents(counted)}
                outstanding={eventOutstandingCents(counted)}
                invoiced={eventInvoiceCents(counted)}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={tab ? 'Nog geen leden' : 'Nog niemand toegevoegd'}
            hint={
              event.closed
                ? undefined
                : tab
                ? 'Voeg via het menu (de drie puntjes) de leden van de groep toe en tik daarna op een naam om te turven. Alles gaat op de factuur.'
                : 'Kies via het menu (de drie puntjes) leden uit de lopende rekening of voeg een gast toe, en tik daarna op een naam om te turven.'
            }
          />
        }
        renderItem={({ item: person, index }) => {
          // Een lid telt zijn gasten mee: hun streepjes zijn op zijn factuur.
          // De gast zelf staat er als eigen regel onder, om te zien wie wat dronk.
          const guests = guestsOf(event, person.id, people);
          const guestCount = guests.reduce(
            (sum, guest) => sum + personItemCount(counted, guest.id),
            0
          );
          const total =
            personTotalCents(counted, person.id) +
            guests.reduce((sum, guest) => sum + personTotalCents(counted, guest.id), 0);
          const count = personItemCount(counted, person.id) + guestCount;
          // Er zit een streep bij die nog niet vast staat.
          const settledCount =
            personItemCount(event, person.id) +
            guests.reduce((sum, guest) => sum + personItemCount(event, guest.id), 0);
          const waiting = count !== settledCount;
          const host = nameOf(person.guestOf);
          const guestRow = isGuestRow(person);
          const note = [
            person.note,
            host ? 'gast van ' + host : null,
            guestCount > 0 ? 'waarvan ' + guestCount + ' van gasten' : null,
          ]
            .filter(Boolean)
            .join(' · ');
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
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                // Een gast staat ingesprongen onder zijn lid.
                marginLeft: guestRow ? space.xl : 0,
              })}>
              <Card
                style={guestRow ? { borderLeftWidth: 4, borderLeftColor: theme.link } : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
                      {person.name}
                    </Text>
                    {display === 'streepjes' ? (
                      // Zoals op papier: de streepjes onder de naam. Een notitie
                      // of gastheer blijft als tekst staan: daaraan zie je welke
                      // van twee dezelfde namen het is.
                      <>
                        {note ? (
                          <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
                            {note}
                          </Text>
                        ) : null}
                        {count > 0 ? (
                          <View style={{ marginTop: space.xs }}>
                            <Tally count={count} color={waiting ? theme.accent : theme.text} />
                          </View>
                        ) : null}
                      </>
                    ) : display === 'aantallen' ? (
                      // Alleen het aantal: het getal staat rechts, hier het woord.
                      <Text
                        style={{
                          color: waiting ? theme.accent : theme.textDim,
                          fontSize: 13,
                          marginTop: 2,
                        }}>
                        {count === 1 ? 'consumptie' : 'consumpties'}
                        {note ? ' · ' + note : ''}
                      </Text>
                    ) : (
                      <Text
                        style={{
                          color: waiting ? theme.accent : theme.textDim,
                          fontSize: 13,
                          marginTop: 2,
                        }}>
                        {count} {count === 1 ? 'consumptie' : 'consumpties'}
                        {note ? ' · ' + note : ''}
                      </Text>
                    )}
                  </View>

                  {invoiced ? (
                    <Badge label="OP FACTUUR" color={theme.link} />
                  ) : isSettled(event, person) ? (
                    <Badge label="BETAALD" color={theme.good} />
                  ) : null}

                  {display === 'streepjes' ? (
                    // Een klein totaal, om een lange rij niet na te hoeven tellen.
                    <Text
                      style={{
                        color: waiting ? theme.accent : theme.textDim,
                        fontSize: 14,
                        fontWeight: '600',
                      }}>
                      {count}
                    </Text>
                  ) : display === 'aantallen' ? (
                    <Text
                      style={{
                        color: waiting ? theme.accent : theme.text,
                        fontSize: 18,
                        fontWeight: '700',
                      }}>
                      {count}
                    </Text>
                  ) : (
                    <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
                      {formatCents(total)}
                    </Text>
                  )}
                </View>
              </Card>
            </Pressable>
          );
          // De rondleiding wijst de bovenste naam aan om turven op te laten zien.
          return index === 0 ? <TourTarget id={ANCHOR.person}>{row}</TourTarget> : row;
        }}
      />

      <NameSuggestModal
        visible={adding === 'name'}
        candidates={nameCandidates}
        onCancel={() => setAdding(null)}
        onPick={(candidate) => {
          setAdding(null);
          if (fromRoster) {
            addRosterPeople(id, [
              { id: candidate.id, name: candidate.name, sectionId: null, removedAt: null },
            ]);
          } else {
            addPerson(id, candidate.name);
          }
        }}
        onNew={(name) => {
          setAdding(null);
          addPerson(id, name);
          // Een nieuwe naam wordt ook een Vaste naam, zodat hij de volgende keer een
          // voorstel is. In een groep met ledenlijst voegt een beheerder hem daar toe.
          if (!fromRoster) addDefaultPerson(name);
        }}
      />

      <GuestModal
        visible={adding === 'guest'}
        // Op een rekening kan een gast bij elk lid horen; op een evenement alleen
        // bij een lid dat uit de rekening is meegekomen.
        hosts={
          tab
            ? people.filter((person) => person.guestOf === null)
            : people.filter((person) => person.memberId !== null)
        }
        onTab={tab}
        onCancel={() => setAdding(null)}
        onSubmit={(guest) => {
          setAdding(null);
          const add = () =>
            addPerson(id, guest.name, {
              billing: guest.billing,
              guestOf: guest.guestOf,
              note: guest.note,
            });
          // Een naam die de app zelf bedacht ("Gast van Anne") mag dubbel.
          if (guest.named) addUnlessSame(guest.name, add);
          else add();
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
