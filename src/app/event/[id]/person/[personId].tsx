import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, SectionList, View } from 'react-native';

import { CheckIcon, CrossIcon } from '@/components/icons';
import { PinModal } from '@/components/pin-modal';
import { TourTarget } from '@/components/tour';
import { Text } from '@/components/text';
import {
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
import { useEvent, useStore } from '@/lib/store';
import { ANCHOR } from '@/lib/tour';
import { activeMenu, itemCents, personItemCount, personTotalCents, quantities } from '@/lib/totals';
import type { MenuItem } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function PersonScreen() {
  const theme = useTheme();
  const { id, personId } = useLocalSearchParams<{ id: string; personId: string }>();
  const event = useEvent(id);
  // De lijst met wat nog wacht om teruggenomen te worden erbij, om te tellen en
  // te laten zien. Wat vaststaat (en dus wat een correctie kan raken) blijft
  // `event`.
  const withWaiting = useWithPending(event);
  const addWaiting = usePending((state) => state.add);
  const addOrder = useStore((state) => state.addOrder);
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  const bottomInset = useBottomInset();

  // Which item is waiting on the PIN, and whether we are asking for it or
  // asking the host to choose one for the first time.
  const [pending, setPending] = useState<string | null>(null);
  const [asking, setAsking] = useState<'verify' | 'set' | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  // The unlocked window must not outlive the screen.
  useEffect(() => () => { if (id) lockCorrections(id); }, [id]);

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
  // streep die nog wacht (die neem je terug met Ongedaan maken).
  const settled = quantities(event, person.id);
  // What each item has cost so far, at the prices it was actually turfed at.
  const spent = itemCents(counted, person.id);
  const offered = activeMenu(event);
  const drinks = offered.filter((item) => item.category === 'drink');
  const food = offered.filter((item) => item.category === 'food');

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

  /** Runs once the PIN is accepted, or once a first PIN has been chosen. */
  const afterVerified = () => {
    unlockCorrections(id);
    setUnlocked(true);
    if (pending) addOrder(id, person.id, pending, -1);
    setPending(null);
    setAsking(null);
  };

  // Waar de rondleiding turven en corrigeren op laat zien: het eerste item
  // van het menu, dat bovenaan het eerste blok staat.
  const firstItemId = sections[0]?.data[0]?.id;

  const renderItem = ({ item }: { item: MenuItem }) => {
    const quantity = Math.max(0, counts[item.id] ?? 0);
    // Hoeveel er al vaststaat. ✕ rekent alleen daarmee, anders kon een
    // correctie een streep afhalen die er (nog) niet echt is.
    const fixed = Math.max(0, settled[item.id] ?? 0);
    const waiting = quantity > fixed;
    const shown = item.id === firstItemId;
    const card = (
      <Card style={{ paddingVertical: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
              {formatCents(item.priceCents)}
              {quantity > 0 ? ` · ${formatCents(spent[item.id] ?? 0)}` : ''}
            </Text>
          </View>

          <StepButton
            icon={(color, size) => <CrossIcon size={size} color={color} />}
            tourId={shown ? ANCHOR.correction : undefined}
            onPress={() => requestRemoval(item)}
            disabled={event.closed || fixed === 0}
          />
          <Text
            style={{
              // Oranje zolang er een streep bij zit die nog niet vast staat.
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
            // Een streep wacht eerst even, zodat hij nog kan worden teruggenomen.
            onPress={() => addWaiting(id, person.id, item.id)}
          />
        </View>
      </Card>
    );
    return shown ? <TourTarget id={ANCHOR.item}>{card}</TourTarget> : card;
  };

  return (
    <Screen
      header={
        // Running total, always visible while tapping. A TopBar rather than a
        // child of Screen, so its background reaches both edges of an iPad
        // while the count and amount stay above the list they describe.
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
              <Text style={{ color: theme.textDim, fontSize: 14 }}>
                {personItemCount(counted, person.id)} consumpties
              </Text>
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
              {formatCents(personTotalCents(counted, person.id))}
            </Text>
          </View>
        </TopBar>
      }>
      <Stack.Screen options={{ title: person.name }} />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + bottomInset }}
        renderSectionHeader={({ section }) => (
          <View style={{ marginTop: space.sm }}>
            <SectionTitle>{section.title}</SectionTitle>
          </View>
        )}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            title="Dit evenement heeft nog geen menu"
            hint="Open Beheer bij het evenement om drankjes en eten toe te voegen."
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
  );
}
