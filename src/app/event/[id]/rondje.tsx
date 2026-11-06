import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Vibration,
  View,
} from 'react-native';

import { BellIcon } from '@/components/bell';
import { CheckIcon } from '@/components/icons';
import { Text } from '@/components/text';
import {
  BottomBar,
  Button,
  Card,
  EmptyState,
  Screen,
  SectionTitle,
  useBottomInset,
} from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useHideAmounts, useStore } from '@/lib/store';
import { activeMenu, activePeople } from '@/lib/totals';
import { radius, space, useTheme } from '@/theme';

/** Wat er na het luiden van de bel op het scherm blijft staan. */
type Rung = {
  giver: string;
  /** "4× Bier, 2× Fris", al uitgeschreven. */
  what: string;
  people: number;
  names: string;
  cents: number;
};

/**
 * Een keuzeknop in de vorm van een pil, voor wie geeft en wat het is.
 */
function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: active ? theme.accent : theme.chip,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text style={{ color: active ? theme.onAccent : theme.text, fontWeight: '600', fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * De bel zelf: een grote bel die een paar keer heen en weer zwaait.
 *
 * Met de Animated van React Native en niet met een bibliotheek, zodat dit over
 * de lucht kan. Geluid kan dat niet (daar is een native bibliotheek voor nodig),
 * dus dat komt met een volgende winkelversie.
 */
function SwingingBell({ color }: { color: string }) {
  const swing = useRef(new Animated.Value(0)).current;
  const size = 150;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(swing, { toValue: -1, duration: 360, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(swing, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      ]),
      { iterations: 5 }
    );
    animation.start();
    return () => animation.stop();
  }, [swing]);

  const rotate = swing.interpolate({ inputRange: [-1, 1], outputRange: ['-22deg', '22deg'] });

  return (
    // Draaien om de bovenkant van de bel in plaats van om het midden: eerst
    // omhoog, dan draaien, dan weer terug.
    <Animated.View
      style={{ transform: [{ translateY: -size / 2 }, { rotate }, { translateY: size / 2 }] }}>
      <BellIcon size={size} color={color} />
    </Animated.View>
  );
}

/**
 * Een rondje geven: iemand geeft, de anderen drinken, de gever betaalt.
 *
 * Alles komt op de rekening van de gever, een plus één per drankje. De
 * ontvangers krijgen er niets bij, ook geen regel van nul euro, want dat
 * vervuilt de aantallen voor de penningmeester. Wel onthoudt elke regel voor
 * wie hij was en bij welk rondje hij hoort (zie `addRound` in store.ts), zodat
 * het logboek er één regel van kan maken.
 *
 * Wat dit niet doet is een rondje terugdraaien. Corrigeren gaat zoals overal:
 * per drankje, op het scherm van de gever, met de correctiecode.
 */
export default function RondjeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const addRound = useStore((state) => state.addRound);
  const hideAmounts = useHideAmounts();
  const bottomInset = useBottomInset();

  const [giverId, setGiverId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  // Wie een drankje krijgt. De waarde is het drankje dat die persoon neemt,
  // of null: dan volgt hij het gekozen drankje. Zo kan iemand fris nemen
  // zonder dat de rest van het rondje daar iets van merkt.
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [deviating, setDeviating] = useState<string | null>(null);
  const [rung, setRung] = useState<Rung | null>(null);

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Rondje' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  // The Rondje button is disabled on a closed event; this covers arriving anyway.
  if (event.closed) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Rondje' }} />
        <EmptyState title="Dit evenement is afgesloten" hint="Er kan niet meer geturfd worden." />
      </Screen>
    );
  }

  const people = activePeople(event);
  const menu = activeMenu(event);
  // Het drankje van het rondje: wat gekozen is, anders het eerste drankje van
  // het menu, want een rondje is meestal één soort.
  const base =
    menu.find((candidate) => candidate.id === itemId) ??
    menu.find((candidate) => candidate.category === 'drink') ??
    menu[0] ??
    null;
  const giver = people.find((person) => person.id === giverId) ?? null;
  const itemOf = (itemKey: string) => menu.find((candidate) => candidate.id === itemKey) ?? null;

  const recipients = people.filter((person) => person.id in chosen);
  const drinks = base
    ? recipients.map((person) => ({
        personId: person.id,
        itemId: chosen[person.id] ?? base.id,
      }))
    : [];
  const cents = drinks.reduce((sum, drink) => sum + (itemOf(drink.itemId)?.priceCents ?? 0), 0);
  const ready = giver !== null && drinks.length > 0;

  const toggle = (personId: string) =>
    setChosen((current) => {
      const next = { ...current };
      if (personId in next) delete next[personId];
      else next[personId] = null;
      return next;
    });

  const everyone = people.length > 0 && people.every((person) => person.id in chosen);
  const toggleEveryone = () =>
    setChosen(everyone ? {} : Object.fromEntries(people.map((person) => [person.id, null])));

  /** "4× Bier, 2× Fris", in de volgorde van het menu. */
  const describe = () => {
    const counts = new Map<string, number>();
    for (const drink of drinks) counts.set(drink.itemId, (counts.get(drink.itemId) ?? 0) + 1);
    return menu
      .filter((candidate) => counts.has(candidate.id))
      .map((candidate) => `${counts.get(candidate.id)}× ${candidate.name}`)
      .join(', ');
  };

  const ring = () => {
    if (!giver) return;
    const summary: Rung = {
      giver: giver.name,
      what: describe(),
      people: drinks.length,
      names: recipients.map((person) => person.name).join(', '),
      cents,
    };
    if (addRound(id, giver.id, drinks) === null) return;
    // Trillen op een telefoon; een iPad heeft geen trilmotor en doet er niets
    // mee. Mislukt het, dan is de bel nog steeds geluid-loos geluid genoeg.
    try {
      Vibration.vibrate([0, 250, 120, 250]);
    } catch {
      // geen trilmotor
    }
    setRung(summary);
  };

  const confirm = () => {
    if (!giver || !ready) return;
    // Een gast die vanavond afrekent en zelf een rondje geeft, betaalt het ook
    // vanavond: het komt niet op de factuur.
    const settlesTonight = event.kind === 'event' && giver.billing === 'tonight';
    Alert.alert(
      `Rondje van ${giver.name}?`,
      `${describe()} voor ${recipients.map((person) => person.name).join(', ')}.` +
        (hideAmounts
          ? ` Alles komt op de rekening van ${giver.name}.`
          : ` ${formatCents(cents)} komt op de rekening van ${giver.name}.`) +
        (settlesTonight ? ` ${giver.name} rekent vanavond af, dus dat betaalt hij zelf vanavond.` : ''),
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Luid de bel', onPress: ring },
      ]
    );
  };

  if (rung) {
    return (
      <Screen
        footer={
          <BottomBar>
            <Button
              title="Klaar"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={{ flex: 1 }}
            />
          </BottomBar>
        }>
        <Stack.Screen options={{ title: 'Rondje' }} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: space.xl,
            gap: space.md,
          }}>
          <SwingingBell color={theme.accent} />
          <Text style={{ color: theme.text, fontSize: 28, fontWeight: '800', textAlign: 'center' }}>
            Rondje van {rung.giver}!
          </Text>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }}>
            {rung.what}
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
            Voor {rung.names}.{'\n'}
            {hideAmounts
              ? `Alles op de rekening van ${rung.giver}.`
              : `${formatCents(rung.cents)} op de rekening van ${rung.giver}.`}
          </Text>
        </View>
      </Screen>
    );
  }

  const label = !giver
    ? 'Kies eerst wie geeft'
    : drinks.length === 0
      ? 'Kies voor wie'
      : hideAmounts
        ? `Luid de bel · ${drinks.length}×`
        : `Luid de bel · ${drinks.length}× · ${formatCents(cents)}`;

  const deviatingPerson = people.find((person) => person.id === deviating) ?? null;

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            title={label}
            icon={(color, size) => <BellIcon size={size} color={color} />}
            disabled={!ready}
            onPress={confirm}
            style={{ flex: 1 }}
          />
        </BottomBar>
      }>
      <Stack.Screen options={{ title: 'Rondje' }} />

      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.sm,
          paddingBottom: space.xxl + bottomInset,
        }}>
        {people.length === 0 ? (
          <EmptyState title="Nog niemand toegevoegd" hint="Voeg eerst mensen toe aan deze lijst." />
        ) : (
          <>
            <SectionTitle>Wie geeft</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {people.map((person) => (
                <Pill
                  key={person.id}
                  label={person.name}
                  active={person.id === giverId}
                  onPress={() => setGiverId(person.id === giverId ? null : person.id)}
                />
              ))}
            </View>

            <View style={{ marginTop: space.md }}>
              <SectionTitle>Wat</SectionTitle>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {menu.map((candidate) => (
                <Pill
                  key={candidate.id}
                  label={hideAmounts ? candidate.name : `${candidate.name} · ${formatCents(candidate.priceCents)}`}
                  active={candidate.id === base?.id}
                  onPress={() => setItemId(candidate.id)}
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
              <Pressable onPress={toggleEveryone} hitSlop={10}>
                <Text style={{ color: theme.link, fontSize: 14, fontWeight: '600' }}>
                  {everyone ? 'Niemand' : 'Iedereen'}
                </Text>
              </Pressable>
            </View>

            {people.map((person) => {
              const selected = person.id in chosen;
              const taken = itemOf(chosen[person.id] ?? base?.id ?? '');
              return (
                <Pressable
                  key={person.id}
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
                      {selected && taken ? (
                        // Een tik op het drankje laat iemand iets anders nemen.
                        <Pressable
                          onPress={() => setDeviating(person.id)}
                          hitSlop={8}
                          style={{
                            paddingVertical: 4,
                            paddingHorizontal: space.sm,
                            borderRadius: radius.pill,
                            backgroundColor: theme.chip,
                          }}>
                          <Text style={{ color: theme.link, fontSize: 13, fontWeight: '600' }}>
                            {taken.name}
                          </Text>
                        </Pressable>
                      ) : null}
                      {selected ? <CheckIcon size={26} color={theme.accent} /> : null}
                    </View>
                  </Card>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      <Modal
        visible={deviatingPerson !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeviating(null)}>
        <Pressable
          onPress={() => setDeviating(null)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            padding: space.lg,
          }}>
          <Pressable
            onPress={(press) => press.stopPropagation()}
            style={{
              backgroundColor: theme.card,
              borderRadius: radius.lg,
              padding: space.lg,
              gap: space.md,
              maxHeight: '80%',
            }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
              {deviatingPerson ? `${deviatingPerson.name} neemt` : 'Wat neemt hij'}
            </Text>
            <ScrollView contentContainerStyle={{ gap: space.sm }}>
              {menu.map((candidate) => {
                const current = deviatingPerson
                  ? (chosen[deviatingPerson.id] ?? base?.id) === candidate.id
                  : false;
                return (
                  <Pressable
                    key={candidate.id}
                    onPress={() => {
                      if (deviatingPerson) {
                        // Hetzelfde als het rondje is geen afwijking: dan volgt hij
                        // weer het gekozen drankje als dat later wisselt.
                        setChosen((now) => ({
                          ...now,
                          [deviatingPerson.id]: candidate.id === base?.id ? null : candidate.id,
                        }));
                      }
                      setDeviating(null);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingVertical: 14,
                      paddingHorizontal: space.md,
                      borderRadius: radius.md,
                      backgroundColor: theme.chip,
                    }}>
                    <View style={{ width: 24, alignItems: 'center' }}>
                      {current ? <CheckIcon size={20} color={theme.accent} /> : null}
                    </View>
                    <Text style={{ flex: 1, color: theme.text, fontWeight: '600' }}>
                      {candidate.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button title="Annuleren" variant="secondary" onPress={() => setDeviating(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
