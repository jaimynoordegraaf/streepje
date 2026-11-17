import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, SectionList, View } from 'react-native';

import { CheckIcon, CrossIcon } from '@/components/icons';
import { PinModal } from '@/components/pin-modal';
import { TourTarget } from '@/components/tour';
import { Text } from '@/components/text';
import {
  BottomBar,
  Button,
  Card,
  EmptyState,
  Screen,
  SectionTitle,
  StepButton,
  TopBar,
  useBottomInset,
} from '@/components/ui';
import { formatCents } from '@/lib/money';
import {
  correctionBlock,
  correctionsUnlocked,
  lockCorrections,
  unlockCorrections,
} from '@/lib/pin';
import { usePending, useWithPending } from '@/lib/pending';
import { useEvent, useHideAmounts, useStore } from '@/lib/store';
import { ANCHOR, useTour } from '@/lib/tour';
import { activeMenu, itemCents, personItemCount, personTotalCents, quantities } from '@/lib/totals';
import type { MenuItem } from '@/lib/types';
import { space, useTheme } from '@/theme';

/** Zo lang mag het scherm zonder tik openstaan voor het zichzelf sluit. */
const IDLE_MS = 2 * 60 * 1000;
/** De laatste seconden daarvan staat er een balk met een teller. */
const WARN_MS = 15 * 1000;

export default function PersonScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { id, personId } = useLocalSearchParams<{ id: string; personId: string }>();
  const event = useEvent(id);
  // De lijst met wat nog wacht (dit bezoek en de bedenktijd erna) erbij, om te
  // tellen en te laten zien. Wat vaststaat (en dus wat een correctie kan raken)
  // blijft `event`.
  const withWaiting = useWithPending(event);
  const waitingLines = usePending((state) => state.waiting);
  const addToVisit = usePending((state) => state.add);
  const takeBackFromVisit = usePending((state) => state.takeBack);
  const addOrder = useStore((state) => state.addOrder);
  const hideAmounts = useHideAmounts();
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const bottomInset = useBottomInset();

  // Which item is waiting on the PIN, and whether we are asking for it or
  // asking the host to choose one for the first time.
  const [pending, setPending] = useState<string | null>(null);
  const [asking, setAsking] = useState<'verify' | 'set' | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  // The unlocked window must not outlive the screen.
  useEffect(() => () => { if (id) lockCorrections(id); }, [id]);

  /**
   * Het bezoek afsluiten: wat je hier hebt gestreept gaat als één regel per
   * drankje naar het totaal (zie pending.ts). Mag vaker worden aangeroepen; de
   * tweede keer is er niets meer.
   */
  const settle = useCallback(() => {
    if (id && personId) usePending.getState().closeVisit(id, personId);
  }, [id, personId]);

  // Sluit het scherm, hoe dan ook: pijl, vegen naar achteren, Klaar of de
  // tijd. `beforeRemove` is het vroegst; het opruimen bij het verdwijnen is
  // het vangnet voor een weg die daar niet langs komt.
  useEffect(() => navigation.addListener('beforeRemove', settle), [navigation, settle]);
  useEffect(() => settle, [settle]);

  const leave = useCallback(() => {
    settle();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [settle, router]);

  // Twee minuten zonder tik: alles vastzetten en terug naar de lijst. Een tik
  // ergens op het scherm zet de klok terug; met de codevraag open staat hij stil.
  const lastTouch = useRef(Date.now());
  const askingRef = useRef(false);
  askingRef.current = asking !== null;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // De dunne balk onder de kop: de resterende tijd, die bij elke tik opnieuw
  // vol loopt. Een breedte kan niet op de native thread; de balk is klein.
  const [idleBar] = useState(() => new Animated.Value(1));
  const restartBar = useCallback(() => {
    idleBar.stopAnimation();
    idleBar.setValue(1);
    Animated.timing(idleBar, {
      toValue: 0,
      duration: IDLE_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [idleBar]);
  useEffect(() => {
    restartBar();
    return () => idleBar.stopAnimation();
  }, [restartBar, idleBar]);

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
    setSecondsLeft(null);
    restartBar();
  }, [restartBar]);
  useEffect(() => {
    const interval = setInterval(() => {
      // De rondleiding leest iemand rustig; die mag het scherm niet onder zich
      // laten sluiten. Met de codevraag open staat de klok stil, en de balk
      // blijft vol.
      if (askingRef.current || useTour.getState().active) {
        lastTouch.current = Date.now();
        restartBar();
        return;
      }
      const left = IDLE_MS - (Date.now() - lastTouch.current);
      if (left <= 0) {
        clearInterval(interval);
        leave();
      } else {
        setSecondsLeft(left <= WARN_MS ? Math.ceil(left / 1000) : null);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [leave, restartBar]);

  const person = event?.people.find((candidate) => candidate.id === personId);

  if (!event || !person) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Persoon' }} />
        <EmptyState title="Deze persoon zit niet meer in dit evenement" />
      </Screen>
    );
  }

  const counted = withWaiting ?? event;
  // Counted once here rather than per menu row, so the whole screen is one pass.
  const counts = quantities(counted, person.id);
  // Alleen wat vaststaat: een correctie haalt daar een turf af, nooit een
  // streep die nog wacht.
  const settled = quantities(event, person.id);
  // What each item has cost so far, at the prices it was actually turfed at.
  const spent = itemCents(counted, person.id);
  const offered = activeMenu(event);
  const drinks = offered.filter((item) => item.category === 'drink');
  const food = offered.filter((item) => item.category === 'food');

  // Wat je deze keer hebt gestreept: de regels van dit bezoek, per drankje.
  const visit: Record<string, number> = {};
  let visitCount = 0;
  let visitCents = 0;
  for (const line of waitingLines) {
    if (!line.open || line.eventId !== id || line.entry.personId !== person.id) continue;
    visit[line.entry.itemId] = (visit[line.entry.itemId] ?? 0) + line.entry.delta;
    visitCount += line.entry.delta;
    visitCents +=
      line.entry.delta *
      (line.entry.priceCents ?? event.menu.find((item) => item.id === line.entry.itemId)?.priceCents ?? 0);
  }

  const sections = [
    { title: 'Drankjes', data: drinks },
    { title: 'Eten', data: food },
  ].filter((section) => section.data.length > 0);

  /**
   * Removing a turf takes money off someone's tab, so it is the one action
   * that has to be earned: an admin phone, plus the PIN. Adding stays a
   * single tap.
   */
  const requestRemoval = (item: MenuItem) => {
    if (event.closed) return;
    const block = correctionBlock(event);

    if (!block.allowed && block.reason === 'not-admin') {
      Alert.alert(
        'Alleen op een beheertelefoon',
        'Turfjes weghalen kan alleen op een telefoon die beheerder is van deze lijst. Vraag een beheerder om de correctie te doen.'
      );
      return;
    }

    if (correctionsUnlocked(id)) {
      addOrder(id, person.id, item.id, -1);
      return;
    }

    setPending(item.id);
    setAsking(!block.allowed && block.reason === 'no-pin' ? 'set' : 'verify');
  };

  /**
   * ✕. Een streep van dit bezoek neem je zonder code terug: hij staat nog
   * nergens. Is er niets van dit bezoek meer, dan gaat het om wat al vaststaat
   * en is de correctiecode nodig.
   */
  const minus = (item: MenuItem) => {
    if ((visit[item.id] ?? 0) > 0) takeBackFromVisit(id, person.id, item.id);
    else requestRemoval(item);
  };

  /** Runs once the PIN is accepted, or once a first PIN has been chosen. */
  const afterVerified = () => {
    unlockCorrections(id);
    setUnlocked(true);
    if (pending) addOrder(id, person.id, pending, -1);
    setPending(null);
    setAsking(null);
  };

  // Waar de rondleiding turven op laat zien: het eerste item van het menu,
  // dat bovenaan het eerste blok staat.
  const firstItemId = sections[0]?.data[0]?.id;

  const renderItem = ({ item }: { item: MenuItem }) => {
    const quantity = Math.max(0, counts[item.id] ?? 0);
    // Hoeveel er al vaststaat. ✕ rekent daar alleen mee als er niets van dit
    // bezoek is: een correctie haalt nooit een streep af die er (nog) niet echt is.
    const fixed = Math.max(0, settled[item.id] ?? 0);
    const now = visit[item.id] ?? 0;
    // Oranje zolang er een streep bij zit die nog niet vast staat.
    const waiting = quantity > fixed;
    const shown = item.id === firstItemId;
    const card = (
      <Card style={{ paddingVertical: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: space.sm,
                marginTop: 2,
              }}>
              <Text style={{ color: theme.textDim, fontSize: 13 }}>
                {formatCents(item.priceCents)}
                {/* De prijs van het drankje staat op de kaart; wat deze persoon
                    er al van heeft kost is wat niet iedereen hoeft te zien. */}
                {quantity > 0 && !hideAmounts ? ` · ${formatCents(spent[item.id] ?? 0)}` : ''}
              </Text>
              {now > 0 ? (
                // Wat je deze keer hebt gestreept, naast het totaal.
                <View
                  style={{
                    backgroundColor: theme.highlight,
                    borderRadius: 999,
                    paddingHorizontal: space.sm,
                    paddingVertical: 1,
                  }}>
                  <Text style={{ color: theme.onHighlight, fontSize: 12, fontWeight: '700' }}>
                    +{now} nu
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <StepButton
            icon={(color, size) => <CrossIcon size={size} color={color} />}
            onPress={() => minus(item)}
            disabled={event.closed || (fixed === 0 && now === 0)}
          />
          <Text
            style={{
              color: waiting ? theme.accent : quantity > 0 ? theme.text : theme.textDim,
              fontSize: 20,
              fontWeight: '700',
              minWidth: 32,
              textAlign: 'center',
            }}>
            {quantity}
          </Text>
          <StepButton
            icon={(color, size) => <CheckIcon size={size} color={color} />}
            tone="accent"
            // A closed event is only looked at: what someone had, not adding to it.
            disabled={event.closed}
            // Een streep van dit bezoek: hij staat pas in het totaal als het scherm sluit.
            onPress={() => addToVisit(id, person.id, item.id)}
          />
        </View>
      </Card>
    );
    return shown ? <TourTarget id={ANCHOR.item}>{card}</TourTarget> : card;
  };

  const footer = event.closed ? undefined : (
    <View>
      {secondsLeft !== null ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: theme.highlight,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
          }}>
          <Text style={{ color: theme.onHighlight, fontSize: 13, fontWeight: '600', lineHeight: 18 }}>
            Over {secondsLeft} seconden gaat dit vast en ga je terug naar de lijst. Tik ergens om te
            blijven.
          </Text>
        </View>
      ) : null}
      <BottomBar>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
            {visitCount > 0
              ? `${visitCount} ${visitCount === 1 ? 'streepje gaat' : 'streepjes gaan'} naar het totaal als je klaar bent.`
              : 'Tik op het vinkje om te turven.'}
          </Text>
        </View>
        <Button title="Klaar" onPress={leave} style={{ minWidth: 110 }} />
      </BottomBar>
    </View>
  );

  return (
    // Elke tik, ook op een knop, zet de twee minuten terug. Deze vangst gebeurt
    // voordat een kind de aanraking krijgt en neemt hem niemand af.
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        touch();
        return false;
      }}>
      <Screen
        footer={footer}
        header={
          // Running total, always visible while tapping. A TopBar rather than a
          // child of Screen, so its background reaches both edges of an iPad
          // while the count and amount stay above the list they describe.
          <>
          <TopBar>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: space.sm,
              }}>
              {/* Shrinks first, so a larger phone text size cannot push the amount
                  into it. The amount itself must never wrap. */}
              <View style={{ gap: 2, flexShrink: 1 }}>
                {hideAmounts ? null : (
                  <Text style={{ color: theme.textDim, fontSize: 14 }}>
                    {personItemCount(counted, person.id)} consumpties
                  </Text>
                )}
                {visitCount > 0 ? (
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      backgroundColor: theme.highlight,
                      borderRadius: 999,
                      paddingHorizontal: space.sm,
                      paddingVertical: 2,
                    }}>
                    <Text style={{ color: theme.onHighlight, fontSize: 12, fontWeight: '700' }}>
                      Deze keer: {visitCount}×{hideAmounts ? '' : ` · ${formatCents(visitCents)}`}
                    </Text>
                  </View>
                ) : null}
                {event.closed ? (
                  <Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '600' }}>
                    Afgesloten
                  </Text>
                ) : unlocked ? (
                  <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '600' }}>
                    Correcties ontgrendeld
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>
                {hideAmounts
                  ? `${personItemCount(counted, person.id)} consumpties`
                  : formatCents(personTotalCents(counted, person.id))}
              </Text>
            </View>
          </TopBar>
          {/* Hoe lang het scherm nog openstaat zonder tik. */}
          <View style={{ height: 4, backgroundColor: theme.chip }}>
            <Animated.View
              style={{
                height: 4,
                backgroundColor: theme.link,
                width: idleBar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }}
            />
          </View>
          </>
        }>
        <Stack.Screen options={{ title: person.name }} />

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: space.lg,
            gap: space.sm,
            // Met de Klaar-balk onderin zit de veilige rand daarin; op een
            // afgesloten lijst is er geen balk.
            paddingBottom: event.closed ? space.xxl + bottomInset : space.lg,
          }}
          renderSectionHeader={({ section }) => (
            <View style={{ marginTop: space.sm }}>
              <SectionTitle>{section.title}</SectionTitle>
            </View>
          )}
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState
              title="Dit evenement heeft nog geen menu"
              hint="Open Deze lijst in het menu om drankjes en eten toe te voegen."
            />
          }
        />

        <PinModal
          visible={asking !== null}
          mode={asking === 'set' ? 'set' : 'verify'}
          eventId={id}
          record={event.correctionPin}
          title={asking === 'set' ? 'Kies een correctiecode' : 'Correctiecode'}
          explanation={
            asking === 'set'
              ? 'Er is nog geen code voor dit evenement. Kies er een; vanaf nu is die nodig om een turfje weg te halen. Bewaar hem goed, hij staat alleen op deze telefoon.'
              : 'Voer de code in om dit turfje weg te halen.'
          }
          onCancel={() => {
            setPending(null);
            setAsking(null);
          }}
          onVerified={afterVerified}
          onSet={(record) => {
            setCorrectionPin(id, record);
            afterVerified();
          }}
        />
      </Screen>
    </View>
  );
}
