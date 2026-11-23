/**
 * Een update binnenhalen en met één tik toepassen.
 *
 * expo-updates haalt bij het openen zelf een update op, maar gebruikt hem pas de
 * volgende start. Voor wie de app dichtzet is dat twee keer openen, voor de
 * bar-iPad die dagen openstaat is het nooit. Dit zoekt daarom ook zelf, haalt
 * op de achtergrond binnen, en laat dan een balkje zien (components/update-bar.tsx)
 * en een rij onder Beheer. De app herlaadt nooit vanzelf: wie aan het turven is
 * wordt niet onderbroken. Alleen een tik op Nu bijwerken herlaadt.
 *
 * Alleen in een echte build. In de ontwikkelversie en in Expo Go staat
 * expo-updates uit en geeft elke aanroep een fout; daar doet alles hier niets.
 * Alleen om het balkje en de rij te kunnen bekijken is er in de ontwikkelversie
 * een oefenstand (zie `sim` en DevUpdateSim), die nooit iets herlaadt.
 *
 * Er is geen eigen administratie naast die van expo-updates: of er iets klaar
 * staat komt uit `Updates.useUpdates()`. Eigen is alleen wat die niet weet --
 * of we net zoeken, of de laatste handmatige poging mislukte.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { create } from 'zustand';

import { usePending } from './pending';
import { useStore } from './store';
import { versionLine } from './version';

/** Het vroegst dat de app zelf nog eens zoekt, ook als hij steeds wakker wordt. */
const MIN_GAP_MS = 10 * 60 * 1000;
/** Zoeken zolang de app openstaat: de bar-iPad komt dagen niet op de voorgrond. */
const EVERY_MS = 60 * 60 * 1000;
/** expo-updates zoekt zelf ook bij het openen; even wachten om niet te botsen. */
const FIRST_DELAY_MS = 8000;

/** Alleen in een echte build staan updates aan. */
const enabled = !__DEV__ && Updates.isEnabled;

export type UpdateStatus =
  /** Updates staan uit (ontwikkelversie, Expo Go). */
  | 'off'
  /** Er is niets klaar. */
  | 'idle'
  | 'checking'
  | 'downloading'
  /** Opgehaald: de volgende start gebruikt hem, of nu met een tik. */
  | 'ready'
  /** De laatste handmatige poging mislukte. */
  | 'error';

type Flow = {
  phase: 'idle' | 'checking' | 'downloading';
  /** Een handmatige poging mislukte; een automatische meldt niets. */
  failed: boolean;
  /** Er is sinds het openen minstens één keer gezocht en het ging goed. */
  checked: boolean;
  /** De ophaalactie zelf meldde dat er iets nieuws staat. */
  fetched: boolean;
  /** Er is op Nu bijwerken getikt. */
  applying: boolean;
  /** Alleen __DEV__: een stand om te bekijken, in plaats van de echte. */
  sim: UpdateStatus | null;
};

export const useUpdateFlow = create<Flow>(() => ({
  phase: 'idle',
  failed: false,
  checked: false,
  fetched: false,
  applying: false,
  sim: null,
}));

let running: Promise<void> | null = null;
let lastRun = 0;

/**
 * Zoeken, en als er iets staat meteen ophalen. Nooit herladen.
 *
 * `manual` is een tik van iemand: dan telt de wachttijd niet en wordt een
 * mislukking onthouden zodat de rij onder Beheer die laat zien. Een automatische
 * ronde (geen verbinding op de bar-iPad) blijft stil.
 */
export function runUpdateCheck(manual = false): Promise<void> {
  if (__DEV__ && manual && useUpdateFlow.getState().sim !== null) {
    // Oefenstand: zoeken duurt even en vindt dan een update. Zo is te zien wat
    // een tik op de rij doet.
    useUpdateFlow.setState({ sim: 'checking' });
    return new Promise((resolve) =>
      setTimeout(() => {
        useUpdateFlow.setState({ sim: 'ready' });
        resolve();
      }, 1500)
    );
  }
  if (!enabled) return Promise.resolve();
  if (running) return running;
  const flow = useUpdateFlow.getState();
  // Er staat al iets klaar; verder zoeken heeft geen zin tot het is toegepast.
  if (flow.fetched) return Promise.resolve();
  if (!manual && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve();

  lastRun = Date.now();
  running = (async () => {
    useUpdateFlow.setState({ phase: 'checking', failed: false });
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable || check.isRollBackToEmbedded) {
        useUpdateFlow.setState({ phase: 'downloading' });
        const result = await Updates.fetchUpdateAsync();
        if (result.isNew || result.isRollBackToEmbedded) useUpdateFlow.setState({ fetched: true });
      }
      useUpdateFlow.setState({ checked: true });
    } catch {
      if (manual) useUpdateFlow.setState({ failed: true });
    } finally {
      useUpdateFlow.setState({ phase: 'idle' });
      running = null;
    }
  })();
  return running;
}

/**
 * De opgehaalde update gebruiken: de app start opnieuw met de nieuwe code.
 *
 * Eerst alles wat nog in de bedenktijd wacht vastzetten, precies zoals bij naar
 * de achtergrond gaan (zie useSettlePending in _layout.tsx), en wachten tot de
 * opslag het heeft. Daarna pas herladen: dat stopt de JavaScript midden in een
 * stap. Zou het wegschrijven toch niet meer lukken, dan staan de wachtende
 * strepen nog in hun eigen sleutel en gaan ze bij de volgende start vast.
 */
export async function applyUpdate(): Promise<void> {
  const flow = useUpdateFlow.getState();
  if (flow.applying) return;

  if (__DEV__ && flow.sim !== null) {
    Alert.alert('Oefenen', 'In de ontwikkelversie herlaadt de app niet.');
    return;
  }
  if (!enabled) return;

  useUpdateFlow.setState({ applying: true });
  try {
    usePending.getState().commitAll();
    // Een lezing komt in de opslag na de schrijfacties van hierboven.
    await Promise.all([
      AsyncStorage.getItem(usePending.persist.getOptions().name ?? ''),
      AsyncStorage.getItem(useStore.persist.getOptions().name ?? ''),
    ]);
    await Updates.reloadAsync();
  } catch {
    Alert.alert(
      'Bijwerken lukte niet',
      'Sluit de app helemaal en open hem opnieuw. De nieuwe versie staat klaar en start dan vanzelf.'
    );
  } finally {
    useUpdateFlow.setState({ applying: false });
  }
}

/**
 * Zoeken bij het openen, bij elke terugkeer naar de voorgrond en daarna elk uur
 * zolang de app openstaat. Eén keer aanroepen, vanuit de wortel van de app.
 */
export function useAutoUpdateCheck() {
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void runUpdateCheck(), FIRST_DELAY_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runUpdateCheck();
    });
    const hourly = setInterval(() => {
      if (AppState.currentState === 'active') void runUpdateCheck();
    }, EVERY_MS);
    return () => {
      clearTimeout(first);
      subscription.remove();
      clearInterval(hourly);
    };
  }, []);
}

/** De stand voor het balkje en de rij, met wat erbij hoort. */
export function useAppUpdate() {
  const updates = Updates.useUpdates();
  const flow = useUpdateFlow();

  let status: UpdateStatus;
  if (__DEV__) {
    status = flow.sim ?? 'off';
  } else if (!Updates.isEnabled) {
    status = 'off';
  } else if (updates.isUpdatePending || flow.fetched) {
    status = 'ready';
  } else if (flow.phase === 'downloading' || updates.isDownloading) {
    status = 'downloading';
  } else if (flow.phase === 'checking' || updates.isChecking) {
    status = 'checking';
  } else if (flow.failed) {
    status = 'error';
  } else {
    status = 'idle';
  }

  return {
    status,
    /** Er is dit keer al gezocht en dat ging goed. */
    checked: flow.checked || (__DEV__ && flow.sim === 'idle'),
    applying: flow.applying,
    check: () => runUpdateCheck(true),
    apply: applyUpdate,
  };
}

/** De twee regels voor de rij onder Beheer: de stand, en welke versie er draait. */
export function updateLines(status: UpdateStatus, checked: boolean): string {
  const state = {
    off: __DEV__ ? 'Updates staan uit in de ontwikkelversie' : 'Updates staan uit',
    idle: checked ? 'Je hebt de nieuwste versie' : 'Tik om te zoeken',
    checking: 'Bezig met zoeken…',
    downloading: 'Nieuwe versie wordt opgehaald…',
    ready: 'Nieuwe versie klaar · Nu bijwerken',
    error: 'Zoeken lukte niet · tik om opnieuw te proberen',
  }[status];
  return state + '\n' + versionLine();
}
