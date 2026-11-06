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
 * Het menu heeft twee lagen. Wat de barploeg nodig heeft staat bovenaan en is
 * open. Alles eronder (totalen, logboek, delen, deze lijst, dit toestel, alle
 * lijsten) zit achter de beheercode: zie `gate` in DropdownMenu.
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
import { PinModal } from '@/components/pin-modal';
import { correctionBlock, correctionsUnlocked, unlockCorrections } from '@/lib/pin';
import { useHomeList, useStore } from '@/lib/store';
import { useAnchor } from '@/lib/tour';
import { radius, space, useTheme } from '@/theme';

export type DropdownItem = {
  label: string;
  /** Een regel eronder, bijvoorbeeld de stand van het delen. */
  hint?: string;
  onPress: () => void;
  /** Een scheidingslijn boven dit item, om groepen uit elkaar te houden. */
  separated?: boolean;
  /** Een kopje boven dit item: het begin van een nieuw blok. Zet ook een lijn. */
  heading?: string;
  /** Achter de beheercode. Zie `gate` in DropdownMenu. */
  locked?: boolean;
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
  const home = useHomeList();
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);
  // Wat er na de code geopend moet worden, en of de code nog gekozen moet worden.
  const [asking, setAsking] = useState<{ mode: 'verify' | 'set'; open: () => void } | null>(null);

  /**
   * Het slot op het onderste blok van het menu.
   *
   * Het gebruikt de code die er al is: de correctiecode van de lijst waar de
   * app mee opent, zoals de weergave onder Dit toestel. Er komt
   * geen tweede code bij. Na een goede code staat alles twee minuten open (het
   * venster van pin.ts), dus Totalen en dan Logboek vraagt maar één keer.
   *
   * Een telefoon die geen beheerder is van die lijst heeft geen code en komt
   * er zonder doorheen: wat daar gevaarlijk is, weigert de database toch al.
   * Zonder lijst valt er niets te beveiligen.
   */
  const gate = (open: () => void) => {
    if (!home) return open();
    const block = correctionBlock(home);
    if (!block.allowed && block.reason === 'not-admin') return open();
    if (correctionsUnlocked(home.id)) return open();
    setAsking({ mode: !block.allowed && block.reason === 'no-pin' ? 'set' : 'verify', open });
  };

  const choose = (item: DropdownItem) => {
    onClose();
    // Pas als het menu echt weg is. Een scherm of een venster openen terwijl
    // een Modal nog wegglijdt faalt op iOS stilletjes; zie whenAlertClosed.
    whenAlertClosed(() => (item.locked ? gate(item.onPress) : item.onPress()));
  };

  /** De code is goed: venster sluiten, en pas daarna het scherm openen. */
  const unlocked = () => {
    const open = asking?.open;
    if (home) unlockCorrections(home.id);
    setAsking(null);
    if (open) whenAlertClosed(open);
  };

  return (
    <>
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
              {(item.separated || item.heading) && index > 0 ? (
                <View
                  style={{ height: 1, backgroundColor: theme.border, marginVertical: space.xs }}
                />
              ) : null}
              {item.heading ? (
                <Text
                  style={{
                    color: theme.textDim,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 0.8,
                    textTransform: 'uppercase',
                    paddingHorizontal: space.lg,
                    paddingTop: space.xs,
                  }}>
                  {item.heading}
                </Text>
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

    <PinModal
      visible={asking !== null && home !== undefined}
      mode={asking?.mode ?? 'verify'}
      eventId={home?.id ?? ''}
      record={home?.correctionPin}
      title="Correctiecode"
      explanation={
        asking?.mode === 'set'
          ? 'Dit deel van het menu is alleen voor de beheerder en vraagt een code. Er is nog geen code voor deze lijst: kies er een. Die is ook nodig om een streep weg te halen. Bewaar hem goed: hij staat alleen op deze telefoon en een vergeten code is niet te herstellen.'
          : 'Voer de code in om verder te gaan. Dit deel van het menu is alleen voor de beheerder.'
      }
      onCancel={() => setAsking(null)}
      onVerified={unlocked}
      onSet={(record) => {
        if (home) setCorrectionPin(home.id, record);
        unlocked();
      }}
    />
    </>
  );
}

/**
 * Het deel van het menu dat overal hetzelfde is: naar de andere lijsten en de
 * instellingen. Beide achter de beheercode.
 *
 * Nieuwe lijst en Deelnemen met code staan hier niet meer: ze zitten op Alle
 * lijsten, onderin. `hideLists` voor het lege beginscherm, waar nog geen lijst
 * is om naartoe te gaan.
 */
export function useGlobalItems({ hideLists = false }: { hideLists?: boolean } = {}): DropdownItem[] {
  const router = useRouter();
  const items: DropdownItem[] = [];

  if (!hideLists) {
    items.push({ label: 'Alle lijsten', onPress: () => router.push('/lists'), locked: true });
  }
  items.push({ label: 'Dit toestel', onPress: () => router.push('/settings'), locked: true });
  return items;
}
