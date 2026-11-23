/**
 * Deze lijst: de naam, de correctiecode en het afsluiten of verwijderen.
 *
 * Dit scherm was lang: ook het menu en de prijzen en de mensen stonden erin. Die
 * hebben sinds de Beheer-pagina elk hun eigen scherm (menu-prijzen.tsx en
 * personen.tsx). Wat hier overblijft zijn de dingen die over de lijst als geheel
 * gaan.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { PromptModal, whenAlertClosed } from '@/components/modals';
import { PinModal } from '@/components/pin-modal';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { correctionsUnlocked, isAdminDevice, unlockCorrections } from '@/lib/pin';
import { useEvent, useStore } from '@/lib/store';
import { space, useTheme } from '@/theme';

export default function SetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);

  const renameEvent = useStore((state) => state.renameEvent);
  const deleteEvent = useStore((state) => state.deleteEvent);
  const setEventClosed = useStore((state) => state.setEventClosed);
  const setCorrectionPin = useStore((state) => state.setCorrectionPin);

  const [renamingEvent, setRenamingEvent] = useState(false);
  // 'change' asks for the current code first, then for the new one.
  const [pinStep, setPinStep] = useState<'none' | 'set' | 'change' | 'change-new'>('none');
  const [deleteAsk, setDeleteAsk] = useState<'verify' | 'set' | null>(null);
  const [reopenAsk, setReopenAsk] = useState<'verify' | 'set' | null>(null);
  const bottomInset = useBottomInset();

  if (!event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Deze lijst' }} />
        <EmptyState title="Dit evenement bestaat niet meer" />
      </Screen>
    );
  }

  // Een lopende rekening is geen evenement, dus zo heet hij hier ook niet.
  const noun = event.kind === 'tab' ? 'Lijst' : 'Evenement';

  const doDeleteEvent = () => {
    deleteEvent(id);
    router.dismissTo('/');
  };

  /**
   * Deleting the event is the last way to make an evening's takings vanish, so
   * on an admin phone the PIN is required, like every other way of removing
   * turfs.
   *
   * On a member's phone, deleting only drops this phone's copy: the shared
   * list and everyone else's still stand. That is leaving, not destroying, so
   * it is not blocked -- and a member has no PIN to give.
   */
  const confirmDeleteEvent = () => {
    const guest = !isAdminDevice(event);

    Alert.alert(
      `${event.name} verwijderen?`,
      guest
        ? 'Dit haalt het evenement van deze telefoon. De gedeelde lijst en de andere telefoons blijven ongemoeid.'
        : 'Dit verwijdert het evenement en alles wat erin geturfd is van deze telefoon. Exporteer eerst als je de gegevens nog nodig hebt.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: () => {
            if (guest || correctionsUnlocked(id)) {
              doDeleteEvent();
              return;
            }
            whenAlertClosed(() => setDeleteAsk(event.correctionPin ? 'verify' : 'set'));
          },
        },
      ]
    );
  };

  /**
   * Closing freezes the evening: no more turfs and no new people. Closing is
   * confirmed once. Reopening needs the PIN, because it lets turfs be added to
   * an evening whose money may already have been counted.
   */
  const confirmClose = () => {
    Alert.alert(
      `${event.name} afsluiten?`,
      'Daarna kan er niet meer geturfd worden en kan er niemand meer bij. Betalingen en exporteren blijven werken. Heropenen kan alleen met de correctiecode.',
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Afsluiten', onPress: () => setEventClosed(id, true) },
      ]
    );
  };

  const requestReopen = () => {
    if (correctionsUnlocked(id)) {
      setEventClosed(id, false);
      return;
    }
    setReopenAsk(event.correctionPin ? 'verify' : 'set');
  };

  const reopen = () => {
    unlockCorrections(id);
    setEventClosed(id, false);
    setReopenAsk(null);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Deze lijst' }} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: 48 + bottomInset }}>
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
          Voor {event.name}. Wat je hier verandert, geldt alleen voor deze lijst.
        </Text>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Correctiecode</SectionTitle>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            {isAdminDevice(event)
              ? 'Zonder deze code kan niemand op deze telefoon een turfje weghalen. Turven zelf blijft gewoon één tik. Dezelfde code opent ook Beheer in het menu. De code staat alleen op deze telefoon, elke beheertelefoon heeft zijn eigen, en een vergeten code is niet te herstellen: schrijf hem op.'
              : 'Turfjes weghalen kan alleen op een beheertelefoon. Op deze telefoon kun je wel turven, maar niets weghalen. Een beheerder van deze lijst kan deze telefoon beheerder maken bij Beheer › Groep, onder deze lijst.'}
          </Text>

          {isAdminDevice(event) ? (
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
                  {event.correctionPin ? 'Ingesteld' : 'Nog niet ingesteld'}
                </Text>
                <Text
                  style={{
                    color: event.correctionPin ? theme.good : theme.danger,
                    fontSize: 13,
                    fontWeight: '700',
                  }}>
                  {event.correctionPin ? 'BEVEILIGD' : 'ONBEVEILIGD'}
                </Text>
              </View>
              <Button
                title={event.correctionPin ? 'Code wijzigen' : 'Code instellen'}
                variant="secondary"
                onPress={() => setPinStep(event.correctionPin ? 'change' : 'set')}
              />
            </Card>
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Naam</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Text style={{ flex: 1, color: theme.text, fontSize: 17, fontWeight: '700' }}>
                {event.name}
              </Text>
              <Pressable onPress={() => setRenamingEvent(true)} hitSlop={8}>
                <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
              </Pressable>
            </View>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <SectionTitle>Afronden</SectionTitle>
          {/* A season tab runs for good, so there is nothing to close. */}
          {event.kind === 'event' && isAdminDevice(event) ? (
            <Button
              title={event.closed ? 'Evenement heropenen' : 'Evenement afsluiten'}
              variant="secondary"
              onPress={event.closed ? requestReopen : confirmClose}
            />
          ) : null}
          {event.kind === 'event' && !isAdminDevice(event) ? (
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              {event.closed
                ? 'Dit evenement is afgesloten. Alleen een beheertelefoon kan het heropenen.'
                : 'Alleen een beheertelefoon kan dit evenement afsluiten.'}
            </Text>
          ) : null}
          <Button title={`${noun} verwijderen`} variant="danger" onPress={confirmDeleteEvent} />
        </View>
      </ScrollView>

      <PromptModal
        visible={renamingEvent}
        title={`${noun} hernoemen`}
        initialValue={event.name}
        onCancel={() => setRenamingEvent(false)}
        onSubmit={(name) => {
          renameEvent(id, name);
          setRenamingEvent(false);
        }}
      />

      <PinModal
        visible={pinStep === 'set' || pinStep === 'change-new'}
        mode="set"
        eventId={id}
        title={pinStep === 'change-new' ? 'Nieuwe correctiecode' : 'Correctiecode instellen'}
        explanation="Vanaf nu is deze code nodig om een turfje weg te halen. Bewaar hem goed: hij staat alleen op deze telefoon en kan niet worden opgezocht."
        onCancel={() => setPinStep('none')}
        onSet={(record) => {
          setCorrectionPin(id, record);
          setPinStep('none');
        }}
      />

      <PinModal
        visible={pinStep === 'change'}
        mode="verify"
        eventId={id}
        record={event.correctionPin}
        title="Huidige code"
        explanation="Voer eerst de huidige code in."
        onCancel={() => setPinStep('none')}
        onVerified={() => setPinStep('change-new')}
      />

      <PinModal
        visible={deleteAsk !== null}
        mode={deleteAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title={`${noun} verwijderen`}
        explanation={
          deleteAsk === 'set'
            ? 'Er is nog geen correctiecode. Kies er een; die is vanaf nu nodig om te verwijderen.'
            : 'Voer de code in om dit evenement van deze telefoon te verwijderen.'
        }
        onCancel={() => setDeleteAsk(null)}
        onVerified={() => {
          setDeleteAsk(null);
          doDeleteEvent();
        }}
        onSet={(record) => {
          setCorrectionPin(id, record);
          setDeleteAsk(null);
          doDeleteEvent();
        }}
      />

      <PinModal
        visible={reopenAsk !== null}
        mode={reopenAsk === 'set' ? 'set' : 'verify'}
        eventId={id}
        record={event.correctionPin}
        title="Evenement heropenen"
        explanation={
          reopenAsk === 'set'
            ? 'Er is nog geen correctiecode. Kies er een; die is vanaf nu nodig om te heropenen en om turfjes weg te halen.'
            : 'Voer de code in om dit evenement te heropenen.'
        }
        onCancel={() => setReopenAsk(null)}
        onVerified={reopen}
        onSet={(record) => {
          setCorrectionPin(id, record);
          reopen();
        }}
      />
    </Screen>
  );
}
