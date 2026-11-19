/**
 * De strook met "Ongedaan maken", boven alle schermen.
 *
 * Staat in de root-layout en niet op het persoonsscherm: wie na een tik terug
 * naar de lijst gaat om de volgende te strepen, moet de vorige nog kunnen
 * terugnemen. Hij is alleen zichtbaar zolang er iets wacht en ligt over de
 * onderkant van het scherm, dus er verschuift niets onder een vinger.
 *
 * Per persoon en drankje één blokje ("Bier × 3 voor Anna"); "Ongedaan maken"
 * haalt daar alles van af. Alles deelt één klok, de
 * balk onderin (zie pending.ts).
 *
 * Alleen een bezoek dat al gesloten is staat hier. Zolang een persoonsscherm
 * openstaat heeft het zijn eigen ✕ en is deze strook niet nodig, dus daar
 * blijft hij weg.
 */

import { usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';
import { useBottomInset } from '@/components/ui';
import { usePending } from '@/lib/pending';
import { useStore } from '@/lib/store';
import { brand, radius, space, useTheme } from '@/theme';

type Group = {
  key: string;
  itemName: string;
  personName: string;
  count: number;
  /** Alle regels van deze groep: die haalt "ongedaan maken" weg, zodat het getal op het blokje klopt. */
  ids: string[];
};

export function UndoStrip() {
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const waiting = usePending((state) => state.waiting);
  const deadline = usePending((state) => state.deadline);
  const restarts = usePending((state) => state.restarts);
  const undo = usePending((state) => state.undo);
  const events = useStore((state) => state.events);
  const onPersonScreen = usePathname().includes('/person/');

  const groups = useMemo(() => {
    const result: Group[] = [];
    for (const { eventId, entry, open } of waiting) {
      if (open) continue;
      const event = events.find((candidate) => candidate.id === eventId);
      const key = eventId + '|' + entry.personId + '|' + entry.itemId;
      const existing = result.find((group) => group.key === key);
      if (existing) {
        existing.count += entry.delta;
        existing.ids.push(entry.id);
      } else {
        result.push({
          key,
          itemName: event?.menu.find((item) => item.id === entry.itemId)?.name ?? 'Consumptie',
          personName: event?.people.find((person) => person.id === entry.personId)?.name ?? '?',
          count: entry.delta,
          ids: [entry.id],
        });
      }
    }
    // De nieuwste links, daar kijkt iemand eerst.
    return result.reverse();
  }, [waiting, events]);

  // De klok: een balk die in de resterende tijd leegloopt en bij elke nieuwe
  // streep opnieuw begint.
  const [progress] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (deadline === null) return;
    progress.setValue(deadline > Date.now() ? 1 : 0);
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: Math.max(0, deadline - Date.now()),
      easing: Easing.linear,
      // Een breedte kan niet op de native thread; de balk is klein.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [restarts, deadline, progress]);

  if (groups.length === 0 || onPersonScreen) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: bottomInset,
        backgroundColor: brand.ink,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: space.md, gap: space.sm }}>
        {groups.map((group) => (
          <View
            key={group.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              backgroundColor: '#2A2A2D',
              borderRadius: radius.md,
              paddingVertical: space.sm,
              paddingLeft: space.md,
              paddingRight: space.sm,
            }}>
            <View>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>
                {group.itemName}
                {group.count > 1 ? ' × ' + group.count : ''}
              </Text>
              <Text style={{ color: '#B9B9BE', fontSize: 12 }}>voor {group.personName}</Text>
            </View>
            <Pressable
              onPress={() => group.ids.forEach(undo)}
              accessibilityRole="button"
              accessibilityLabel={`Ongedaan maken: ${group.itemName} voor ${group.personName}`}
              hitSlop={6}
              style={({ pressed }) => ({
                backgroundColor: theme.accent,
                borderRadius: radius.sm,
                paddingHorizontal: space.md,
                paddingVertical: 12,
                opacity: pressed ? 0.7 : 1,
              })}>
              <Text style={{ color: theme.onAccent, fontSize: 14, fontWeight: '700' }}>
                Ongedaan maken
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Animated.View
        style={{
          height: 5,
          backgroundColor: theme.accent,
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}
