/**
 * Het menu achter de drie puntjes in de kop.
 *
 * Alles wat niet turven is -- delen, beheer, andere lijsten, instellingen --
 * zit hierachter, zodat het scherm zelf alleen de lijst is.
 *
 * Met opzet geen native menu (zoals de UIMenu van iOS): dat is een bibliotheek
 * met native code, en wat native is kan niet met `eas update` mee maar vraagt
 * een nieuwe winkelversie. Dit is gewoon een Modal, en een Modal doet op beide
 * platforms hetzelfde, inclusief de terugknop van Android die hem sluit.
 *
 * De staat van het menu (open of dicht) hoort in het scherm, niet in de kop.
 * Een `headerRight: () => <...>` is bij elke render van het scherm een nieuw
 * onderdeel, en een onderdeel dat zichzelf steeds opnieuw opbouwt vergeet dat
 * het openstond. Daarom is `MenuButton` hier alleen de knop, en hangt
 * `DropdownMenu` onderaan in het scherm.
 */

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { whenAlertClosed } from '@/components/modals';
import { useAnchor } from '@/lib/tour';
import { radius, space, useTheme } from '@/theme';

export type DropdownItem = {
  label: string;
  /** Een regel eronder, bijvoorbeeld de stand van het delen. */
  hint?: string;
  onPress: () => void;
  /** Een scheidingslijn boven dit item, om groepen uit elkaar te houden. */
  separated?: boolean;
};

/** Open/dicht en waar het menu hangt. `top` is de onderkant van de knop. */
export function useDropdown() {
  const [top, setTop] = useState<number | null>(null);
  const close = useCallback(() => setTop(null), []);
  return { top, open: setTop, close };
}

/**
 * De drie puntjes. Op iOS liggend, op Android staand: zoals elk platform het
 * zelf tekent, zodat het meteen als menu wordt herkend.
 *
 * `alert` zet er een puntje bij. Voor wat in het menu zelf niet opvalt maar
 * wel aandacht vraagt, zoals een lijst die niet meer synchroniseert.
 */
export function MenuButton({
  onOpen,
  alert = false,
  tourId,
}: {
  onOpen: (top: number) => void;
  alert?: boolean;
  /** Zie Button in ui.tsx: meldt de knop aan bij de rondleiding. */
  tourId?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const anchor = useAnchor(tourId);

  const press = () => {
    // De plek van de knop op het scherm, zodat het menu er recht onder hangt.
    // Lukt meten niet, dan is de statusbalk plus een gewone kop de beste gok.
    const fallback = insets.top + 56;
    if (!anchor.ref.current) return onOpen(fallback);
    anchor.ref.current.measureInWindow((_x, y, _w, height) =>
      onOpen(height > 0 ? y + height : fallback)
    );
  };

  const dot = { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.text };

  return (
    <Pressable
      ref={anchor.ref}
      onLayout={anchor.onLayout}
      collapsable={false}
      onPress={press}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Menu"
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.55 : 1,
      })}>
      <View style={{ flexDirection: Platform.OS === 'ios' ? 'row' : 'column', gap: 4 }}>
        <View style={dot} />
        <View style={dot} />
        <View style={dot} />
      </View>
      {alert ? (
        <View
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: theme.danger,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function DropdownMenu({
  top,
  items,
  onClose,
}: {
  top: number | null;
  items: DropdownItem[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const choose = (item: DropdownItem) => {
    onClose();
    // Pas als het menu echt weg is. Een scherm of een venster openen terwijl
    // een Modal nog wegglijdt faalt op iOS stilletjes; zie whenAlertClosed.
    whenAlertClosed(item.onPress);
  };

  return (
    <Modal
      visible={top !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      {/* Een tik naast het menu sluit het. Geen verduistering: het is een
          menu, geen venster, en de lijst eronder blijft leesbaar. */}
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <View
          style={{
            position: 'absolute',
            top: (top ?? 0) + space.xs,
            right: space.md,
            minWidth: 230,
            maxWidth: Math.min(320, width - space.md * 2),
            backgroundColor: theme.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.border,
            paddingVertical: space.xs,
            // Een schaduw op iOS, hoogte op Android: de een kent het andere niet.
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}>
          {items.map((item, index) => (
            <View key={item.label}>
              {item.separated && index > 0 ? (
                <View
                  style={{ height: 1, backgroundColor: theme.border, marginVertical: space.xs }}
                />
              ) : null}
              <Pressable
                onPress={() => choose(item)}
                accessibilityRole="menuitem"
                style={({ pressed }) => ({
                  paddingVertical: space.md,
                  paddingHorizontal: space.lg,
                  backgroundColor: pressed ? theme.chip : 'transparent',
                })}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                  {item.label}
                </Text>
                {item.hint ? (
                  <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>
                    {item.hint}
                  </Text>
                ) : null}
              </Pressable>
            </View>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Het deel van het menu dat overal hetzelfde is: naar de andere lijsten, een
 * nieuwe lijst, deelnemen aan een gedeelde, en de instellingen.
 *
 * `hideLists` voor het overzicht zelf, dat er al staat.
 */
export function useGlobalItems(
  openNewList: () => void,
  { hideLists = false }: { hideLists?: boolean } = {}
): DropdownItem[] {
  const router = useRouter();
  const items: DropdownItem[] = [];

  if (!hideLists) {
    items.push({ label: 'Alle lijsten', onPress: () => router.push('/lists'), separated: true });
  }
  items.push(
    { label: 'Nieuwe lijst', onPress: openNewList, separated: hideLists },
    { label: 'Deelnemen met code', onPress: () => router.push('/join') },
    { label: 'Instellingen', onPress: () => router.push('/settings'), separated: true }
  );
  return items;
}
