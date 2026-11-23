/**
 * De Beheer-pagina: alles wat de beheerder en de penningmeester nodig hebben,
 * op één plek, achter de beheercode.
 *
 * Het ⋯-menu heeft voor de barploeg alleen wat zij nodig heeft, en daaronder één
 * item, Beheer, met het slot (zie `gate` in menu.tsx). De code wordt dus één
 * keer gevraagd, aan de deur, en niet bij elk scherm. Binnen blijf je zo lang
 * je wilt, tot de iPad vijf minuten met rust is gelaten (zie lib/beheer.ts).
 *
 * De pagina is ingedeeld op taak, niet op schermnaam: afrekenen, iets
 * rechtzetten, de lijst instellen, dit toestel. De bestaande schermen blijven
 * zoals ze zijn en de rijen wijzen ernaar. Alleen de twee exports staan er zelf,
 * omdat de penningmeester ze het vaakst nodig heeft en ze één knop zijn.
 *
 * Elke rij opent één ding op een eigen scherm. Wat eerst een stuk van een lang
 * scherm was (Deze lijst, Dit toestel) is daarvoor in stukken gesneden:
 * personen.tsx, menu-prijzen.tsx en groep.tsx zijn daar uit voortgekomen.
 *
 * De rijen zijn gegevens (zie `Row`), geen vaste tekening: een rij kan later
 * verdwijnen of ergens anders heen wijzen zonder dat de rest verandert.
 *
 * Zonder lijst (de lege staat) bestaat het deel over een lijst niet; dan staat
 * er alleen wat voor het toestel geldt.
 */

import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { PeriodModal } from '@/components/modals';
import { Text } from '@/components/text';
import { Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { useBeheerIdle } from '@/lib/beheer';
import { describeError } from '@/lib/errors';
import {
  exportLogXlsx,
  exportTreasurerCsv,
  periodsInEvent,
  wholeEventPeriod,
} from '@/lib/export';
import { listPlace, placeLabel } from '@/lib/group-lists';
import { isAdminDevice, unlockSecondsLeft } from '@/lib/pin';
import { shareLine } from '@/lib/share-status';
import { useEvent, useHomeList, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { useStartTour } from '@/lib/tour';
import { updateLines, useAppUpdate } from '@/lib/updates';
import { radius, space, useTheme } from '@/theme';

type Row = {
  key: string;
  label: string;
  hint?: string;
  /** Rood: iets wat aandacht vraagt. */
  alert?: boolean;
  onPress: () => void;
};

type Group = {
  title: string;
  /** Een regel onder de titel: bij welke taak dit hoort. */
  subtitle?: string;
  rows: Row[];
  /** Een regel onder de rijen, zonder knop. */
  note?: string;
};

function RowView({ row, last }: { row: Row; last: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={row.onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.border,
        backgroundColor: pressed ? theme.chip : 'transparent',
      })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{row.label}</Text>
        {row.hint ? (
          <Text
            style={{
              color: row.alert ? theme.danger : theme.textDim,
              fontSize: 12,
              marginTop: 2,
              fontWeight: row.alert ? '700' : '400',
            }}>
            {row.hint}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: theme.textDim, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

function Pill({ label, tone }: { label: string; tone: 'plain' | 'good' | 'bad' }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: tone === 'bad' ? 'transparent' : theme.chip,
        borderWidth: tone === 'bad' ? 1 : 0,
        borderColor: theme.danger,
      }}>
      <Text
        style={{
          color: tone === 'good' ? theme.good : tone === 'bad' ? theme.danger : theme.text,
          fontSize: 12,
          fontWeight: '700',
        }}>
        {label}
      </Text>
    </View>
  );
}

export function BeheerPage({ id }: { id?: string }) {
  const theme = useTheme();
  const router = useRouter();
  const event = useEvent(id);
  const home = useHomeList();
  const eventCount = useStore((state) => state.events.filter((candidate) => !candidate.demo).length);
  const group = useStore((state) => state.group);
  const groupListCount = useStore(
    (state) =>
      state.events.filter(
        (candidate) => !candidate.demo && Boolean(candidate.groupId) && candidate.groupId === state.group?.id
      ).length
  );
  const startTour = useStartTour();
  const update = useAppUpdate();
  const bottomInset = useBottomInset();
  const [busy, setBusy] = useState(false);
  const [choosingPeriod, setChoosingPeriod] = useState(false);
  // De seconden die de code nog openstaat, voor de regel in de stand van zaken.
  const [secondsLeft, setSecondsLeft] = useState(() => (home ? unlockSecondsLeft(home.id) : 0));

  useBeheerIdle();

  useEffect(() => {
    if (!home) return;
    const tick = () => setSecondsLeft(unlockSecondsLeft(home.id));
    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [home]);

  // Een lijst die er niet meer is, bijvoorbeeld na het verwijderen vanuit Deze lijst.
  if (id && !event) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Beheer' }} />
        <EmptyState title="Deze lijst bestaat niet meer" />
      </Screen>
    );
  }

  /** Een export uitvoeren en van een mislukking een leesbare melding maken. */
  const runExport = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert('Exporteren mislukt', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  // Uit wat er op de telefoon zelf staat: Beheer houdt geen verbinding bij.
  // Wachtende turven zijn op de bar-iPad gewoon; pas na lang geen verbinding
  // gaat het puntje aan (zie share-status.ts).
  const sharing = event
    ? shareLine({
        shared: Boolean(event.share),
        pending: event.unsyncedEntryIds.length,
        unsaved: false,
        lastSyncedAt: event.share?.lastSyncedAt ?? null,
        now: Date.now(),
      })
    : null;

  const groups: Group[] = [];

  if (event && id) {
    const tab = event.kind === 'tab';
    const go =
      (
        pathname:
          | '/event/[id]/totals'
          | '/event/[id]/log'
          | '/event/[id]/personen'
          | '/event/[id]/menu-prijzen'
          | '/event/[id]/setup'
      ) =>
      () =>
        router.push({ pathname, params: { id } });

    groups.push({
      title: 'Afrekenen',
      subtitle: 'Na een avond of aan het eind van de maand',
      rows: [
        {
          key: 'totals',
          label: 'Totalen en betalen',
          hint: tab ? 'Per persoon, wat er op de factuur komt' : 'Per persoon, afvinken wat betaald is',
          onPress: go('/event/[id]/totals'),
        },
        {
          key: 'treasurer',
          label: 'Export penningmeester',
          hint: busy ? 'Bezig…' : 'Kwartaal kiezen en delen',
          onPress: () => {
            const periods = periodsInEvent(event);
            if (periods.length <= 1) {
              void runExport(() => exportTreasurerCsv(event, periods[0] ?? wholeEventPeriod(event)));
              return;
            }
            setChoosingPeriod(true);
          },
        },
        {
          key: 'log-xlsx',
          label: 'Logboek naar Excel',
          hint: busy ? 'Bezig…' : 'Het hele logboek, om na te kijken of door te sturen',
          onPress: () => void runExport(() => exportLogXlsx(event)),
        },
      ],
    });

    groups.push({
      title: 'Iets rechtzetten',
      subtitle: 'Een fout of een vraag achteraf',
      rows: [
        {
          key: 'log',
          label: 'Logboek',
          hint: 'Wie turfde wat, per persoon, en wanneer',
          onPress: go('/event/[id]/log'),
        },
        {
          key: 'people',
          label: tab ? 'Leden' : 'Personen',
          hint: 'Hernoemen, verwijderen, terugzetten',
          onPress: go('/event/[id]/personen'),
        },
      ],
      note: 'Een streep weghalen doe je bij de persoon zelf, met de code. Dat blijft daar.',
    });

    groups.push({
      title: 'De lijst instellen',
      rows: [
        {
          key: 'menu',
          label: 'Menu en prijzen',
          hint: 'Voor deze lijst',
          onPress: go('/event/[id]/menu-prijzen'),
        },
        {
          key: 'setup',
          label: 'Naam, code en afsluiten',
          hint: event.correctionPin || !isAdminDevice(event) ? undefined : 'Nog geen code ingesteld',
          alert: !event.correctionPin && isAdminDevice(event),
          onPress: go('/event/[id]/setup'),
        },
      ],
    });
  }

  const device: Row[] = [
    {
      key: 'settings',
      label: 'Naam en weergave',
      hint: 'Naam van de iPad, bedragen of streepjes',
      onPress: () => router.push('/settings'),
    },
  ];
  // Zonder server bestaan groep, ledenlijst en ideeën niet.
  if (isSyncConfigured) {
    device.push(
      {
        key: 'group',
        label: 'Groep',
        // Delen is geen los begrip meer: de groep is waar de lijsten staan, dus
        // het puntje voor "lang niets verstuurd" staat hier.
        hint: group
          ? `${group.name} · ${groupListCount === 1 ? '1 lijst' : `${groupListCount} lijsten`}${
              sharing?.alert ? ` · ${sharing.label}` : ''
            }`
          : 'Maken of meedoen',
        alert: Boolean(sharing?.alert),
        onPress: () => router.push('/groep'),
      },
      {
        key: 'roster',
        label: 'Ledenlijst',
        hint: 'De namen van de groep',
        onPress: () => router.push('/ledenlijst'),
      }
    );
  }
  device.push({
    key: 'new-lists',
    label: 'Menu en vaste namen',
    hint: 'Voor nieuwe lijsten',
    onPress: () => router.push('/nieuwe-lijsten'),
  });
  if (isSyncConfigured) {
    device.push({
      key: 'ideas',
      label: 'Ideeën',
      hint: 'Insturen en bekijken',
      onPress: () => router.push('/ideas'),
    });
  }
  device.push({
    key: 'tour',
    label: 'Rondleiding',
    hint: 'Een korte wandeling door de app, start meteen',
    onPress: startTour,
  });
  // Zonder lijst is er niets om naartoe te gaan, dus ook geen Alle lijsten.
  if (eventCount > 0) {
    device.push({
      key: 'lists',
      label: 'Alle lijsten',
      hint: eventCount === 1 ? '1 lijst' : `${eventCount} lijsten`,
      onPress: () => router.push('/lists'),
    });
  }
  device.push({
    key: 'update',
    label: 'Zoeken naar updates',
    hint: updateLines(update.status, update.checked),
    onPress: () => {
      // Een tik zoekt meteen; staat er al een update klaar, dan gebruikt hij die.
      // Bezig of uit (ontwikkelversie): niets, en ook geen fout.
      if (update.status === 'ready') void update.apply();
      else if (update.status === 'idle' || update.status === 'error') void update.check();
    },
  });
  groups.push({
    title: 'Dit toestel',
    subtitle: 'Geldt voor alle lijsten',
    rows: device,
  });

  const adminCode = event && isAdminDevice(event) ? event.correctionPin : undefined;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Beheer' }} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        {event ? (
          <Card style={{ gap: space.sm }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
              {event.name || (event.kind === 'tab' ? 'Lopende rekening' : 'Evenement')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Pill label={event.closed ? 'Afgesloten' : 'Open'} tone={event.closed ? 'plain' : 'good'} />
              {isAdminDevice(event) ? (
                <Pill
                  label={event.correctionPin ? 'Beveiligd met code' : 'Geen code ingesteld'}
                  tone={event.correctionPin ? 'good' : 'bad'}
                />
              ) : (
                <Pill label="Geen beheertelefoon" tone="plain" />
              )}
              <Pill label={placeLabel(listPlace(event, group?.id ?? null))} tone="plain" />
              {event.unsyncedEntryIds.length > 0 && event.share ? (
                <Pill
                  label={`${event.unsyncedEntryIds.length} nog te versturen`}
                  tone={sharing?.alert ? 'bad' : 'plain'}
                />
              ) : null}
              {event.share && sharing?.lastContact ? (
                <Pill label={`Laatst verbonden ${sharing.lastContact}`} tone="plain" />
              ) : null}
            </View>
            {adminCode ? (
              <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
                {secondsLeft > 0
                  ? `Code nog ${Math.ceil(secondsLeft / 60)} min open voor weghalen en verwijderen.`
                  : 'Code verlopen: weghalen en verwijderen vraagt hem opnieuw.'}{' '}
                Blijft de iPad hier staan, dan gaat hij na 5 minuten zelf terug naar de lijst.
              </Text>
            ) : null}
          </Card>
        ) : (
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
            Er is nog geen lijst. Wat voor dit toestel geldt, vind je hieronder.
          </Text>
        )}

        {groups.map((group) => (
          <View key={group.title} style={{ gap: space.xs }}>
            <SectionTitle>{group.title}</SectionTitle>
            {group.subtitle ? (
              <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: space.xs }}>
                {group.subtitle}
              </Text>
            ) : null}
            <View
              style={{
                backgroundColor: theme.card,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: theme.border,
                overflow: 'hidden',
              }}>
              {group.rows.map((row, index) => (
                <RowView key={row.key} row={row} last={index === group.rows.length - 1 && !group.note} />
              ))}
              {group.note ? (
                <Text
                  style={{
                    color: theme.textDim,
                    fontSize: 12,
                    lineHeight: 17,
                    paddingVertical: space.md,
                    paddingHorizontal: space.lg,
                  }}>
                  {group.note}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      <PeriodModal
        visible={choosingPeriod && event !== undefined}
        periods={event ? periodsInEvent(event) : []}
        onCancel={() => setChoosingPeriod(false)}
        onSubmit={(period) => {
          setChoosingPeriod(false);
          if (event) void runExport(() => exportTreasurerCsv(event, period));
        }}
      />
    </Screen>
  );
}
