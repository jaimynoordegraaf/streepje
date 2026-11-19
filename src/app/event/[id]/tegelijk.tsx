import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  OrderPicker,
  chosenDrinks,
  describeDrinks,
  useOrderPicker,
} from '@/components/order-picker';
import { Text } from '@/components/text';
import { BottomBar, Button, EmptyState, Screen } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { useEvent, useHideAmounts, useStore } from '@/lib/store';
import { useListOrder } from '@/lib/use-list-order';
import { activeMenu } from '@/lib/totals';
import { space, useTheme } from '@/theme';

/**
 * Putting drinks on several people at once, each on their own account.
 *
 * At a bar people order together, and doing that person by person means leaving
 * and re-entering a screen for every name. Here the drink is chosen once at the
 * top and the names are ticked off; then the next drink and the next names, so a
 * whole order goes in at once. Kiezen werkt zoals bij Rondje (order-picker.tsx).
 *
 * Dit heette eerst Rondje. Een rondje is nu iets anders (rondje.tsx): daar
 * betaalt één persoon voor de rest. Hier turft ieder voor zichzelf.
 */
export default function TegelijkTurvenScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const addOrder = useStore((state) => state.addOrder);
  // Op de iPad staan er streepjes en geen bedragen; dan hoort hier ook geen
  // rondjestotaal.
  const hideAmounts = useHideAmounts();
  // Dezelfde volgorde als de lijst waar je vandaan komt.
  const people = useListOrder(event, false);
  const picker = useOrderPicker();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Tegelijk turven' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  // The button is disabled on a closed event; this covers arriving anyway.
  if (event.closed) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Tegelijk turven' }} />
        <EmptyState title="Dit evenement is afgesloten" hint="Er kan niet meer geturfd worden." />
      </Screen>
    );
  }

  const menu = activeMenu(event);
  const drinks = chosenDrinks(picker, people, menu);
  const cents = drinks.reduce((sum, drink) => sum + drink.item.priceCents, 0);
  const ready = drinks.length > 0;

  const confirm = () => {
    // Elke naam op zijn eigen rekening, met zijn eigen drankje.
    for (const drink of drinks) addOrder(id, drink.personId, drink.item.id, 1);
    router.back();
  };

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            title={
              ready
                ? hideAmounts
                  ? `Turf ${drinks.length}×`
                  : `Turf ${drinks.length}× · ${formatCents(cents)}`
                : picker.pick === null
                  ? 'Kies eerst een drankje'
                  : 'Kies voor wie'
            }
            disabled={!ready}
            onPress={confirm}
            style={{ flex: 1 }}
          />
        </BottomBar>
      }>
      <Stack.Screen options={{ title: 'Tegelijk turven' }} />

      <OrderPicker picker={picker} people={people} menu={menu} hideAmounts={hideAmounts} />
      {ready ? (
        // Wat er gezet gaat worden, uitgeschreven, voor een bestelling met meer
        // dan één drankje.
        <Text
          style={{
            color: theme.textDim,
            fontSize: 13,
            textAlign: 'center',
            paddingHorizontal: space.lg,
            paddingBottom: space.sm,
          }}>
          {describeDrinks(drinks, menu)}
        </Text>
      ) : null}
    </Screen>
  );
}
