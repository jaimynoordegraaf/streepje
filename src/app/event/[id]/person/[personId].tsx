import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, SectionList, View } from 'react-native';

import { CheckIcon, CrossIcon } from '@/components/icons';
import { PinModal } from '@/components/pin-modal';
import { Text } from '@/components/text';
import { Card, EmptyState, Screen, SectionTitle, StepButton, useBottomInset } from '@/components/ui';
import { formatCents } from '@/lib/money';
import {
  correctionBlock,
  correctionsUnlocked,
  lockCorrections,
  unlockCorrections,
} from '@/lib/pin';
import { useEvent, useStore } from '@/lib/store';
import { personItemCount, personTotalCents, quantities } from '@/lib/totals';
import type { MenuItem } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function PersonScreen() {
  const theme = useTheme();
  const { id, personId } = useLocalSearchParams<{ id: string; personId: string }>();
  const event = useEvent(id);
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

  // Counted once here rather than per menu row, so the whole screen is one pass.
  const counts = quantities(event, person.id);
  const drinks = event.menu.filter((item) => item.category === 'drink');
  const food = event.menu.filter((item) => item.category === 'food');

  const sections = [
    { title: 'Drankjes', data: drinks },
    { title: 'Eten', data: food },
  ].filter((section) => section.data.length > 0);

  /**
   * Removing a turf takes money off someone's tab, so it is the one action
   * that has to be earned: the phone that owns the event, plus the PIN.
   * Adding stays a single tap.
   */
  const requestRemoval = (item: MenuItem) => {
    const block = correctionBlock(event);

    if (!block.allowed && block.reason === 'guest') {
      Alert.alert(
        'Alleen op de hoofdtelefoon',
        'Turfjes weghalen kan alleen op de telefoon die dit evenement heeft aangemaakt. Vraag degene die deelt om de correctie te doen.'
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

  const renderItem = ({ item }: { item: MenuItem }) => {
    const quantity = Math.max(0, counts[item.id] ?? 0);
    return (
      <Card style={{ paddingVertical: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
              {formatCents(item.priceCents)}
              {quantity > 0 ? ` · ${formatCents(quantity * item.priceCents)}` : ''}
            </Text>
          </View>

          <StepButton
            icon={(color, size) => <CrossIcon size={size} color={color} />}
            onPress={() => requestRemoval(item)}
            disabled={quantity === 0}
          />
          <Text
            style={{
              color: quantity > 0 ? theme.text : theme.textDim,
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
            onPress={() => addOrder(id, person.id, item.id, 1)}
          />
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: person.name }} />

      {/* Running total, always visible while tapping. */}
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          backgroundColor: theme.card,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.textDim, fontSize: 14 }}>
            {personItemCount(event, person.id)} consumpties
          </Text>
          {unlocked ? (
            <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '600' }}>
              Correcties ontgrendeld
            </Text>
          ) : null}
        </View>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>
          {formatCents(personTotalCents(event, person.id))}
        </Text>
      </View>

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
