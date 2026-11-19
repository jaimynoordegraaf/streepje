import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { CheckIcon } from '@/components/icons';
import { Text } from '@/components/text';
import { Card, EmptyState, SectionTitle } from '@/components/ui';
import { formatCents } from '@/lib/money';
import type { MenuItem, Person } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

/**
 * Een bestelling opnemen, voor Tegelijk turven en voor Rondje.
 *
 * Eén manier van kiezen in beide schermen: het drankje kies je bovenaan, daarna
 * tik je de namen aan die dat drankje krijgen. Dan een ander drankje bovenaan
 * en de volgende namen. Een naam houdt het drankje waarmee je hem aantikte; een
 * ander drankje kiezen verandert niets aan wie al is aangevinkt.
 *
 * Wat de twee schermen onderscheidt, wie betaalt, zit niet hier. Tegelijk turven
 * boekt elke regel op de naam zelf, Rondje op de gever.
 */

/** Wie wat krijgt: personId -> itemId. Wie er niet in staat, is niet aangevinkt. */
export type Choice = Record<string, string>;

export type OrderPicker = {
  /** Het drankje dat bovenaan gekozen is, of null. */
  pick: string | null;
  choice: Choice;
  /** Moet "Kies eerst een drankje" getoond worden? */
  hint: boolean;
  /** Er is al op Iedereen getikt en dat kan nog een stap terug. */
  canGoBack: boolean;
  /** Iedereen heeft al iets, dus de knop heeft niets te doen. */
  everyoneDone: (people: Person[]) => boolean;
  choose: (itemId: string | null) => void;
  /** Een tik op een naam. */
  tap: (personId: string) => void;
  /** Een tik op Iedereen, of op Terug als daar net op Iedereen is getikt. */
  tapEveryone: (people: Person[]) => void;
};

/**
 * De toestand van het kiezen. Een eigen hook en niet in het component zelf, omdat
 * het scherm eromheen (het bedrag, de bevestiging) ook moet weten wat er gekozen is.
 *
 * - Een naam die al is aangevinkt gaat bij een tik altijd weer uit, ook als er
 *   bovenaan een ander drankje staat. Wie iets anders wil, tikt hem uit en dan
 *   weer aan. Een misser herstel je zo met één tik.
 * - Iedereen vult alleen de namen aan die nog niets hebben. "Fris voor Sanne,
 *   de rest bier" gaat dus goed. De tik daarna heet Terug en zet de selectie
 *   terug zoals hij vlak vóór Iedereen was.
 * - Er staat geen drankje voorgekozen: je moet er eerst een tikken, zodat er niet
 *   stilletjes iets geboekt wordt.
 */
export function useOrderPicker(): OrderPicker {
  const [pick, setPick] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>({});
  const [before, setBefore] = useState<Choice | null>(null);
  const [hint, setHint] = useState(false);

  const choose = useCallback((itemId: string | null) => {
    setPick(itemId);
    if (itemId) setHint(false);
  }, []);

  const tap = useCallback(
    (personId: string) => {
      if (!pick) {
        setHint(true);
        return;
      }
      setHint(false);
      // Zelf een naam aantikken maakt het "terug" van Iedereen ongeldig.
      setBefore(null);
      setChoice((current) => {
        const next = { ...current };
        if (personId in next) delete next[personId];
        else next[personId] = pick;
        return next;
      });
    },
    [pick]
  );

  const tapEveryone = useCallback(
    (people: Person[]) => {
      if (before) {
        setChoice(before);
        setBefore(null);
        return;
      }
      if (!pick) {
        setHint(true);
        return;
      }
      setHint(false);
      setBefore(choice);
      const next = { ...choice };
      for (const person of people) if (!(person.id in next)) next[person.id] = pick;
      setChoice(next);
    },
    [before, pick, choice]
  );

  const everyoneDone = useCallback(
    (people: Person[]) => people.length === 0 || people.every((person) => person.id in choice),
    [choice]
  );

  return useMemo(
    () => ({
      pick,
      choice,
      hint,
      canGoBack: before !== null,
      everyoneDone,
      choose,
      tap,
      tapEveryone,
    }),
    [pick, choice, hint, before, everyoneDone, choose, tap, tapEveryone]
  );
}

/** Wat er gekozen is, in de volgorde van de lijst: wie, en welk drankje. */
export function chosenDrinks(
  picker: OrderPicker,
  people: Person[],
  menu: MenuItem[]
): { personId: string; item: MenuItem }[] {
  const items = new Map(menu.map((item) => [item.id, item]));
  const result: { personId: string; item: MenuItem }[] = [];
  for (const person of people) {
    const item = items.get(picker.choice[person.id] ?? '');
    if (item) result.push({ personId: person.id, item });
  }
  return result;
}

/** "4× Bier, 2× Fris", in de volgorde van het menu. */
export function describeDrinks(drinks: { item: MenuItem }[], menu: MenuItem[]): string {
  const counts = new Map<string, number>();
  for (const drink of drinks) counts.set(drink.item.id, (counts.get(drink.item.id) ?? 0) + 1);
  return menu
    .filter((candidate) => counts.has(candidate.id))
    .map((candidate) => `${counts.get(candidate.id)}× ${candidate.name}`)
    .join(', ');
}

/** Een keuzeknop in de vorm van een pil. */
export function Pill({
  label,
  active,
  onPress,
  badge,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Hoeveel namen dit drankje al hebben. */
  badge?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: active ? theme.accent : theme.chip,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text style={{ color: active ? theme.onAccent : theme.text, fontWeight: '600', fontSize: 14 }}>
        {label}
      </Text>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            paddingHorizontal: 6,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(0,0,0,0.16)',
            alignItems: 'center',
          }}>
          <Text style={{ color: active ? theme.onAccent : theme.text, fontSize: 12, fontWeight: '800' }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Het scherm om een bestelling te kiezen: wat je bovenaan (`top`) zet, dan de
 * drankjes, dan de namen met Iedereen. De namen staan in de volgorde van de lijst.
 */
export function OrderPicker({
  picker,
  people,
  menu,
  hideAmounts,
  top,
}: {
  picker: OrderPicker;
  people: Person[];
  menu: MenuItem[];
  hideAmounts: boolean;
  /** Boven de drankjes, bij Rondje: wie geeft. */
  top?: ReactNode;
}) {
  const theme = useTheme();
  const counts = new Map<string, number>();
  for (const person of people) {
    const itemId = picker.choice[person.id];
    if (itemId) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  return (
    <FlatList
      data={people}
      extraData={picker.choice}
      keyExtractor={(person) => person.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
      ListHeaderComponent={
        <View style={{ gap: space.sm, marginBottom: space.sm }}>
          {top}

          <View style={top ? { marginTop: space.md } : undefined}>
            <SectionTitle>Wat</SectionTitle>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {menu.map((candidate) => (
              <Pill
                key={candidate.id}
                label={
                  hideAmounts
                    ? candidate.name
                    : `${candidate.name} · ${formatCents(candidate.priceCents)}`
                }
                active={candidate.id === picker.pick}
                badge={counts.get(candidate.id)}
                onPress={() => picker.choose(candidate.id === picker.pick ? null : candidate.id)}
              />
            ))}
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
              onPress={() => picker.tapEveryone(people)}
              disabled={!picker.canGoBack && picker.everyoneDone(people)}
              hitSlop={10}>
              <Text
                style={{
                  color: theme.link,
                  fontSize: 14,
                  fontWeight: '600',
                  opacity: !picker.canGoBack && picker.everyoneDone(people) ? 0.4 : 1,
                }}>
                {picker.canGoBack ? 'Terug' : 'Iedereen'}
              </Text>
            </Pressable>
          </View>

          {picker.hint ? (
            <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>
              Kies eerst een drankje
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title="Nog niemand toegevoegd"
          hint="Voeg eerst mensen toe aan deze lijst."
        />
      }
      renderItem={({ item: person }) => {
        const taken = menu.find((candidate) => candidate.id === picker.choice[person.id]);
        const selected = taken !== undefined;
        return (
          <Pressable
            onPress={() => picker.tap(person.id)}
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
                {taken ? (
                  // Alleen tekst: het drankje kies je bovenaan, niet hier.
                  <Text style={{ color: theme.link, fontSize: 13, fontWeight: '600' }}>
                    {taken.name}
                  </Text>
                ) : null}
                {selected ? <CheckIcon size={26} color={theme.accent} /> : null}
              </View>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
