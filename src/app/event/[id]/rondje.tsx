import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Platform, Vibration, View } from 'react-native';

import { BellIcon } from '@/components/bell';
import {
  OrderPicker,
  Pill,
  chosenDrinks,
  describeDrinks,
  useOrderPicker,
} from '@/components/order-picker';
import { Text } from '@/components/text';
import { BottomBar, Button, EmptyState, Screen, SectionTitle } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useHideAmounts, useStore } from '@/lib/store';
import { activeMenu } from '@/lib/totals';
import { useListOrder } from '@/lib/use-list-order';
import { space, useTheme } from '@/theme';

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
 * Kiezen gaat zoals bij Tegelijk turven (order-picker.tsx): eerst de gever, dan
 * het drankje bovenaan, dan de namen; een ander drankje en weer de namen. Het
 * drankje bij een naam is alleen tekst. Alleen wie betaalt verschilt.
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
  // Dezelfde volgorde als de lijst waar je vandaan komt.
  const people = useListOrder(event, false);
  const picker = useOrderPicker();

  const [giverId, setGiverId] = useState<string | null>(null);
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

  const menu = activeMenu(event);
  const giver = people.find((person) => person.id === giverId) ?? null;

  const drinks = chosenDrinks(picker, people, menu);
  const names = drinks.map(
    (drink) => people.find((person) => person.id === drink.personId)?.name ?? ''
  );
  const cents = drinks.reduce((sum, drink) => sum + drink.item.priceCents, 0);
  const ready = giver !== null && drinks.length > 0;

  const ring = () => {
    if (!giver) return;
    const summary: Rung = {
      giver: giver.name,
      what: describeDrinks(drinks, menu),
      people: drinks.length,
      names: names.join(', '),
      cents,
    };
    const booked = addRound(
      id,
      giver.id,
      drinks.map((drink) => ({ personId: drink.personId, itemId: drink.item.id }))
    );
    if (booked === null) return;
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
      `${describeDrinks(drinks, menu)} voor ${names.join(', ')}.` +
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
      ? picker.pick === null
        ? 'Kies eerst een drankje'
        : 'Kies voor wie'
      : hideAmounts
        ? `Luid de bel · ${drinks.length}×`
        : `Luid de bel · ${drinks.length}× · ${formatCents(cents)}`;

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

      <OrderPicker
        picker={picker}
        people={people}
        menu={menu}
        hideAmounts={hideAmounts}
        top={
          people.length === 0 ? null : (
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
            </>
          )
        }
      />
    </Screen>
  );
}
