/**
 * De rondleiding zoals je hem ziet: een donker scherm met een gat over de
 * knop waar het op dat moment over gaat, en een kaartje met de uitleg.
 *
 * Hij hangt in de wortel van de app (zie app/_layout.tsx) en niet in een
 * scherm, want hij moet blijven staan terwijl hij zelf van scherm naar scherm
 * vaart. Dat varen gebeurt met `replace` en niet met `push`: anders groeit er
 * onder de rondleiding een stapel schermen die daarna niemand meer wil.
 *
 * Tikken gaan niet door naar de app eronder. Dat is met opzet: de rondleiding
 * laat de echte knoppen zien, maar wie er tijdens de uitleg op drukt staat
 * ineens ergens anders dan waar de volgende stap over gaat. Bovendien zou een
 * tik op Delen de voorbeeldlijst alsnog de server op sturen, en dat is precies
 * wat niet mag gebeuren.
 *
 * Wat er verteld wordt en waar het naar wijst staat in lib/tour.ts.
 */

import { usePathname, useRouter } from 'expo-router';
import { ReactNode, useEffect } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { Button, contentMaxWidth } from '@/components/ui';
import { useStore } from '@/lib/store';
import { STEPS, useAnchor, useTour, type TourScreen } from '@/lib/tour';
import { radius, space, useTheme } from '@/theme';

/**
 * Zet om een knop of een rij heen die de rondleiding moet kunnen aanwijzen.
 *
 * Voor een `Button` of een `StepButton` is dit niet nodig: die hebben een
 * eigen `tourId`, zodat er geen extra View tussen komt die de opmaak van de
 * knop eromheen zou kunnen verschuiven.
 */
export function TourTarget({
  id,
  style,
  children,
}: {
  id: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const anchor = useAnchor(id);
  return (
    <View ref={anchor.ref} onLayout={anchor.onLayout} collapsable={false} style={style}>
      {children}
    </View>
  );
}

/** Hoeveel ruimte er om een aangewezen knop heen vrij blijft. */
const HALO = 8;

/**
 * Het pad waar een stap hoort, als tekst om te vergelijken met wat er staat.
 *
 * Varen gebeurt hieronder met de getypte vorm, waar expo-router de \[id\] zelf
 * invult; dit is dezelfde route nog een keer, maar dan uitgeschreven.
 */
function pathFor(screen: TourScreen, eventId: string, personId: string): string {
  switch (screen) {
    case 'home':
      return '/';
    case 'event':
      return `/event/${eventId}`;
    case 'person':
      return `/event/${eventId}/person/${personId}`;
    case 'totals':
      return `/event/${eventId}/totals`;
    case 'log':
      return `/event/${eventId}/log`;
  }
}

/** De bolletjes: hoeveel stappen er zijn en waar je bent. */
function Dots({ count, active }: { count: number; active: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.sm }}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            width: index === active ? 20 : 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: index === active ? theme.accent : theme.border,
          }}
        />
      ))}
    </View>
  );
}

export function TourOverlay() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const active = useTour((state) => state.active);
  const step = useTour((state) => state.step);
  const demoEventId = useTour((state) => state.demoEventId);
  const demoPersonId = useTour((state) => state.demoPersonId);
  const anchors = useTour((state) => state.anchors);
  const next = useTour((state) => state.next);
  const stop = useTour((state) => state.stop);
  const setTourSeen = useStore((state) => state.setTourSeen);

  const current = STEPS[step];

  /**
   * Zorg dat het scherm eronder bij de stap hoort.
   *
   * Vergelijken met het pad dat er nu staat, in plaats van onthouden waar we
   * al geweest zijn. Dat scheelt twee dingen. Twee stappen over hetzelfde
   * scherm varen niet opnieuw, en opnieuw varen zou dat scherm opbouwen en
   * daarmee de gemeten plek van de knop weggooien. En wie op Android de
   * terugknop indrukt komt vanzelf weer terug bij de stap: het pad klopt dan
   * niet meer met waar de rondleiding is, dus wordt er opnieuw gevaren.
   */
  useEffect(() => {
    if (!active || !demoEventId || !demoPersonId) return;
    const screen = STEPS[step]?.screen;
    if (!screen || pathname === pathFor(screen, demoEventId, demoPersonId)) return;

    switch (screen) {
      case 'home':
        router.replace('/');
        break;
      case 'event':
        router.replace({ pathname: '/event/[id]', params: { id: demoEventId } });
        break;
      case 'person':
        router.replace({
          pathname: '/event/[id]/person/[personId]',
          params: { id: demoEventId, personId: demoPersonId },
        });
        break;
      case 'totals':
        router.replace({ pathname: '/event/[id]/totals', params: { id: demoEventId } });
        break;
      case 'log':
        router.replace({ pathname: '/event/[id]/log', params: { id: demoEventId } });
        break;
    }
  }, [active, step, demoEventId, demoPersonId, pathname, router]);

  // De voorbeeldlijst is er nog niet in het tikje tussen aanzetten en aanmaken.
  if (!active || !current || !demoEventId) return null;

  const finish = () => {
    stop();
    setTourSeen(true);
    // Terug naar het beginscherm, dat de voorbeeldlijst opruimt zodra het ziet
    // dat er geen rondleiding meer loopt. Opruimen vanaf hier zou een scherm
    // van die lijst in zijn laatste beeldjes "bestaat niet meer" laten zeggen.
    router.replace('/');
  };

  const last = step === STEPS.length - 1;
  const rect = current.anchor ? anchors[current.anchor] : undefined;

  // Een knop die (nog) niet gemeten is of buiten beeld staat krijgt geen gat.
  // Dan blijft alleen het kaartje over, en dat klopt nog steeds -- beter dan
  // een lichtvlek ergens in het niets.
  const onScreen =
    rect && rect.y + rect.height > 0 && rect.y < height && rect.x < width && rect.x + rect.width > 0;

  const hole = onScreen
    ? {
        x: Math.max(0, rect.x - HALO),
        y: Math.max(0, rect.y - HALO),
        width: Math.min(width, rect.width + HALO * 2),
        height: rect.height + HALO * 2,
      }
    : null;

  const dim = 'rgba(0, 0, 0, 0.72)';
  // Het kaartje staat onderaan, tenzij het gat daar zit. Vaste plekken in
  // plaats van het kaartje overal tegenaan schuiven: op een kleine telefoon
  // met de tekstgrootte omhoog is dat het enige dat altijd past.
  const cardAtTop = hole !== null && hole.y + hole.height > height * 0.5;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Vangt elke tik op de app eronder. Ligt onder het kaartje, dus de
          knoppen daarvan werken gewoon. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} />

      {hole ? (
        <>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, height: hole.y, backgroundColor: dim }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: hole.y + hole.height,
              bottom: 0,
              backgroundColor: dim,
            }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, top: hole.y, width: hole.x, height: hole.height, backgroundColor: dim }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: hole.x + hole.width,
              right: 0,
              top: hole.y,
              height: hole.height,
              backgroundColor: dim,
            }}
          />
          {/* De rand om het gat, zodat duidelijk is dat het om die knop gaat
              en niet om wat er toevallig naast staat. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: hole.x,
              top: hole.y,
              width: hole.width,
              height: hole.height,
              borderWidth: 2,
              borderColor: theme.accent,
              borderRadius: radius.lg,
            }}
          />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />
      )}

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          ...(cardAtTop ? { top: insets.top + space.md } : { bottom: insets.bottom + space.md }),
          paddingHorizontal: space.lg,
          alignItems: 'center',
        }}>
        <View
          style={{
            width: '100%',
            maxWidth: contentMaxWidth,
            backgroundColor: theme.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.border,
            padding: space.lg,
            gap: space.md,
          }}>
          <View style={{ gap: space.xs }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>
              {current.title}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 15, lineHeight: 22 }}>
              {current.body}
            </Text>
          </View>

          <Dots count={STEPS.length} active={step} />

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {last ? null : (
              <Button title="Overslaan" variant="secondary" onPress={finish} style={{ flex: 1 }} />
            )}
            <Button
              title={last ? 'Aan de slag' : 'Volgende'}
              onPress={last ? finish : next}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
