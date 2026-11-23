/**
 * Het balkje "Nieuwe versie klaar · Nu bijwerken".
 *
 * Staat in de indeling van een scherm, vlak boven de onderste knoppen (via
 * `footer` van Screen), en niet er overheen: de lijst wordt onderaan een rij
 * korter, de namen schuiven niet en de knoppen blijven waar ze waren. Alleen op
 * schermen waar niet wordt gestreept: de lijst zelf, Alle lijsten en het lege
 * beginscherm. Niet in een persoonsscherm, Rondje of Tegelijk turven.
 *
 * Verschijnt alleen als er echt iets klaar staat; geen update, geen verbinding
 * of een mislukte poging laten niets zien. De app herlaadt nooit vanzelf (zie
 * lib/updates.ts).
 *
 * Een merkkleur is hier een vlak onder donkere tekst, ook in de donkere stand;
 * de knop is de oranje van alle knoppen.
 */

import { Pressable, View } from 'react-native';

import { Text } from '@/components/text';
import { contentMaxWidth, useBottomInset } from '@/components/ui';
import { useAppUpdate } from '@/lib/updates';
import { useTour } from '@/lib/tour';
import { brand, radius, space } from '@/theme';

/**
 * `bottom`: het balkje is het onderste van het scherm en houdt zelf ruimte voor
 * de navigatiebalk of het streepje van de iPhone vrij. Boven een BottomBar niet.
 */
export function UpdateBar({ bottom = false }: { bottom?: boolean }) {
  const { status, apply, applying } = useAppUpdate();
  const tourActive = useTour((state) => state.active);
  const inset = useBottomInset();

  // Tijdens de rondleiding is de lijst een voorbeeld; daar hoort het niet bij.
  if (status !== 'ready' || tourActive) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: brand.blueTint,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.12)',
        paddingBottom: bottom ? inset : 0,
      }}>
      <View
        style={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
        }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: brand.ink, fontSize: 14, fontWeight: '700' }}>Nieuwe versie klaar</Text>
          <Text style={{ color: brand.ink, fontSize: 12 }}>Je werk blijft staan</Text>
        </View>
        <Pressable
          onPress={() => void apply()}
          disabled={applying}
          accessibilityRole="button"
          accessibilityLabel="Nu bijwerken"
          hitSlop={6}
          style={({ pressed }) => ({
            backgroundColor: brand.orange,
            borderRadius: radius.sm,
            paddingHorizontal: space.md,
            paddingVertical: 12,
            opacity: pressed || applying ? 0.7 : 1,
          })}>
          <Text style={{ color: brand.ink, fontSize: 14, fontWeight: '700' }}>
            {applying ? 'Bezig…' : 'Nu bijwerken'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
