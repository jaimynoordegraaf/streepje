import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { ListScreen } from '@/components/list-screen';
import { useNewList } from '@/components/new-list';
import { DropdownMenu, MenuButton, useDropdown, useGlobalItems } from '@/components/menu';
import { Button, Screen } from '@/components/ui';
import { UpdateBar } from '@/components/update-bar';
import { useHomeList, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { useStartTour, useTour } from '@/lib/tour';
import { useGroupSync } from '@/lib/use-group-sync';
import { space, useTheme } from '@/theme';

/**
 * De eerste keer: een toestel zonder groep en zonder lijsten.
 *
 * De groep is de basis van streepje, dus daar begint het: meedoen met de groep
 * van de barploeg, of er een maken. Deelnemen aan één lijst met een eigen code
 * bestaat niet meer. Klein eronder kan het ook zonder groep, voor een iPad die
 * op de eerste dag geen verbinding heeft; een lijst van zo'n toestel gaat later
 * met "Zet in de groep" alsnog de groep in.
 */
function WelcomeScreen({ onSkip }: { onSkip: () => void }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'streepje' }} />
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700', textAlign: 'center' }}>
          Welkom bij streepje
        </Text>
        <Text
          style={{
            color: theme.textDim,
            fontSize: 15,
            lineHeight: 22,
            textAlign: 'center',
            marginBottom: space.md,
          }}>
          De barploeg werkt in één groep. Doe mee met de groep, dan verschijnen alle lijsten
          vanzelf op dit toestel.
        </Text>
        <Button title="Meedoen met een groepscode" onPress={() => router.push('/groep/meedoen')} />
        <Button
          title="Groep maken"
          variant="secondary"
          onPress={() => router.push({ pathname: '/groep', params: { maken: '1' } })}
        />
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
          Doet de groep al mee? Scan de QR op een ander toestel, bij Beheer › Groep.
        </Text>
        <Pressable onPress={onSkip} hitSlop={10} style={{ alignSelf: 'center', marginTop: space.lg }}>
          <Text style={{ color: theme.link, fontSize: 14, fontWeight: '600' }}>Zonder groep beginnen</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/**
 * Een telefoon zonder lopende rekening.
 *
 * Een verse telefoon, of een die alleen evenementen heeft. Met opzet geen
 * rekening die vanzelf wordt aangemaakt: wie met de groep meedoet heeft er
 * anders meteen een lege tweede naast die van de groep. Eén tik op de knop is
 * genoeg om er zelf een te beginnen.
 */
function NoListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const eventCount = useStore((state) => state.events.filter((event) => !event.demo).length);
  const group = useStore((state) => state.group);
  const createEvent = useStore((state) => state.createEvent);
  const { shareIntoGroup } = useGroupSync();
  const newList = useNewList();
  const menu = useDropdown();
  const items = useGlobalItems();
  // Alleen voor deze keer: wie "Zonder groep beginnen" kiest, krijgt de vraag
  // bij een volgende start weer, zolang er nog niets is.
  const [skipped, setSkipped] = useState(false);

  if (isSyncConfigured && !group && eventCount === 0 && !skipped) {
    return <WelcomeScreen onSkip={() => setSkipped(true)} />;
  }

  return (
    <Screen footer={<UpdateBar bottom />}>
      <Stack.Screen
        options={{
          title: 'streepje',
          headerRight: () => <MenuButton onOpen={menu.open} />,
        }}
      />

      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
          Nog geen lopende rekening
        </Text>
        <Text
          style={{
            color: theme.textDim,
            fontSize: 15,
            lineHeight: 22,
            textAlign: 'center',
            marginBottom: space.md,
          }}>
          {group
            ? `Begin er een voor de gewone baravonden, waar alles op de factuur van de penningmeester gaat. Hij komt meteen in ${group.name}.`
            : 'Begin er een voor de gewone baravonden, waar alles op de factuur van de penningmeester gaat.'}
        </Text>
        <Button
          title="Lopende rekening starten"
          onPress={() => {
            // De lijst verschijnt vanzelf: het beginscherm kiest de nieuwste
            // rekening zodra er een is.
            const id = createEvent('', 'tab');
            void shareIntoGroup(id);
          }}
        />
        {/* Zonder lijst bestaat Alle lijsten (met Nieuw) nog niet, dus zonder
            deze knop kon een toestel zonder rekening geen evenement maken. Gaat
            via dezelfde weg als Nieuw: meteen in de groep, en daarna open. */}
        <Button title="Evenement maken" variant="secondary" onPress={newList.start} />
        {isSyncConfigured && !group ? (
          <Button
            title="Meedoen met een groep"
            variant="secondary"
            onPress={() => router.push('/groep/meedoen')}
          />
        ) : null}
        {eventCount > 0 ? (
          <Button
            title={eventCount === 1 ? 'Naar je evenement' : `Naar je ${eventCount} lijsten`}
            variant="secondary"
            onPress={() => router.push('/lists')}
          />
        ) : null}
      </View>

      <DropdownMenu top={menu.top} items={items} onClose={menu.close} />
      {newList.modal}
    </Screen>
  );
}

/**
 * Het beginscherm: de lopende streeplijst, meteen open.
 *
 * De app begon als vervanging van één papieren streeplijst achter de bar, en zo
 * hoort hij ook te openen: in die lijst, niet in een overzicht van lijsten. Dat
 * overzicht staat op /lists, via het menu.
 *
 * Welke lijst het is staat bij `useHomeList` in de opslag. Is er geen, dan
 * komt de lege staat hierboven.
 */
export default function HomeScreen() {
  const home = useHomeList();
  const tourSeen = useStore((state) => state.tourSeen);
  const removeDemoEvents = useStore((state) => state.removeDemoEvents);
  const hasDemo = useStore((state) => state.events.some((event) => event.demo));
  const tourActive = useTour((state) => state.active);
  const startTour = useStartTour();

  // Lijsten van de groep ophalen zodra dit scherm in beeld komt, voor wie
  // meedoet aan de barploeg. Zie use-group-sync.ts.
  useGroupSync(true);

  /**
   * De rondleiding, de eerste keer dat de app opengaat.
   *
   * Vanaf hier en niet vanuit de wortel van de app: dit is het eerste scherm
   * dat er staat, dus de navigatie is klaar om ernaartoe te varen. De vlag
   * gaat pas om als de rondleiding klaar is, dus wie halverwege wegdrukt
   * krijgt hem de volgende keer nog een keer.
   */
  useEffect(() => {
    if (!tourSeen) startTour();
  }, [tourSeen, startTour]);

  /**
   * De voorbeeldlijst van de rondleiding opruimen.
   *
   * Hier, omdat de rondleiding hier eindigt en dit scherm dus toch in beeld
   * komt: opruimen terwijl een scherm van die lijst nog staat zou dat scherm
   * "bestaat niet meer" laten zeggen. Het is meteen het vangnet -- blijft er
   * ooit een voorbeeldlijst achter, dan is hij bij het eerstvolgende bezoek
   * aan het beginscherm alsnog weg.
   */
  useEffect(() => {
    if (!tourActive && hasDemo) removeDemoEvents();
  }, [tourActive, hasDemo, removeDemoEvents]);

  // De key zorgt dat een andere rekening (na het verwijderen van de vorige)
  // met een schone lijst begint in plaats van de open vensters over te nemen.
  return home ? <ListScreen key={home.id} id={home.id} /> : <NoListScreen />;
}
