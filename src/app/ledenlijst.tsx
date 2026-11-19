import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { PromptModal, SectionPickerModal, whenAlertClosed } from '@/components/modals';
import { Button, Card, EmptyState, Screen, SectionTitle, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { nameKey } from '@/lib/names';
import { newId, useHomeList, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import {
  addRosterMembers,
  addRosterSection,
  removeRosterSection,
  renameRosterMember,
  renameRosterSection,
  setRosterMemberRemoved,
  setRosterMemberSection,
} from '@/lib/sync';
import type { RosterMember, RosterSection } from '@/lib/types';
import { useRoster } from '@/lib/use-roster';
import { space, useTheme } from '@/theme';

/**
 * De ledenlijst van de groep: één lijst namen voor alle telefoons.
 *
 * Staat onder Dit toestel, dus achter de beheercode van het menu. Daarbovenop
 * dwingt de database af dat alleen een beheerder van de groep hier iets kan
 * veranderen; op een andere telefoon is dit scherm alleen om te lezen.
 */
export default function RosterScreen() {
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const group = useStore((state) => state.group);
  const defaultPeople = useStore((state) => state.defaultPeople);
  const localSections = useStore((state) => state.sections);
  const linkRosterIds = useStore((state) => state.linkRosterIds);
  const home = useHomeList();
  const { roster, refresh } = useRoster();

  const [adding, setAdding] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [renaming, setRenaming] = useState<RosterMember | null>(null);
  const [renamingSection, setRenamingSection] = useState<RosterSection | null>(null);
  const [sectioning, setSectioning] = useState<RosterMember | null>(null);
  const [busy, setBusy] = useState(false);

  /** Een wijziging doorvoeren en daarna de lijst opnieuw lezen. Fouten staan in een melding. */
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (error) {
      Alert.alert('Niet gelukt', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!isSyncConfigured || !group) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Ledenlijst' }} />
        <EmptyState
          title="Deze telefoon zit in geen groep"
          hint="De ledenlijst hoort bij de groep. Maak of kies een groep bij Beheer, onder Groep; daarna staat hij op alle telefoons van de groep."
        />
      </Screen>
    );
  }

  if (!roster) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Ledenlijst' }} />
        <EmptyState
          title="De ledenlijst is nog niet opgehaald"
          hint="Er is geen verbinding, of de database mist nog de ledenlijst (supabase/019-group-roster.sql). Probeer het later nog eens."
        />
      </Screen>
    );
  }

  const admin = roster.admin;
  const active = roster.members.filter((member) => member.removedAt === null);
  const removed = roster.members.filter((member) => member.removedAt !== null);
  const byName = (a: RosterMember, b: RosterMember) => nameKey(a.name).localeCompare(nameKey(b.name));
  const sectionName = (id: string | null) =>
    roster.sections.find((section) => section.id === id)?.name ?? null;

  // De namen die er al zijn, voor het overnemen de eerste keer: de leden van de
  // lopende rekening en de Vaste namen van deze telefoon, elk één keer.
  const plan = (() => {
    const seen = new Set<string>();
    const names: { name: string; sectionName: string | null }[] = [];
    const take = (name: string, section: string | null) => {
      const key = nameKey(name);
      if (key === '' || seen.has(key)) return;
      seen.add(key);
      names.push({ name: name.trim().replace(/\s+/g, ' '), sectionName: section });
    };
    for (const saved of defaultPeople) {
      take(saved.name, localSections.find((section) => section.id === saved.sectionId)?.name ?? null);
    }
    for (const person of home?.people ?? []) {
      if (person.removedAt === null && person.guestOf === null) take(person.name, null);
    }
    // Wat er al in de ledenlijst staat hoeft niet nog eens.
    return names.filter((entry) => !roster.members.some((member) => nameKey(member.name) === nameKey(entry.name)));
  })();

  const adopt = () =>
    run(async () => {
      // Speltakken eerst, op naam: wat er al is wordt hergebruikt.
      const sectionIds = new Map(roster.sections.map((section) => [nameKey(section.name), section.id]));
      for (const entry of plan) {
        if (!entry.sectionName || sectionIds.has(nameKey(entry.sectionName))) continue;
        const sectionId = newId();
        await addRosterSection(group.id, sectionId, entry.sectionName);
        sectionIds.set(nameKey(entry.sectionName), sectionId);
      }
      const fresh = plan.map((entry) => ({
        id: newId(),
        name: entry.name,
        sectionId: entry.sectionName ? (sectionIds.get(nameKey(entry.sectionName)) ?? null) : null,
      }));
      await addRosterMembers(group.id, fresh);

      // Wie op de lopende rekening staat wordt aan zijn naam in de ledenlijst gekoppeld.
      if (home) {
        const known = new Map(
          [...roster.members.map((m) => [nameKey(m.name), m.id] as const), ...fresh.map((m) => [nameKey(m.name), m.id] as const)]
        );
        const links = home.people.flatMap((person) => {
          const rosterId = known.get(nameKey(person.name));
          return rosterId && !person.rosterId ? [{ personId: person.id, rosterId }] : [];
        });
        if (links.length > 0) linkRosterIds(home.id, links);
      }
    });

  const addName = (name: string) => {
    setAdding(false);
    const same = roster.members.find((member) => nameKey(member.name) === nameKey(name));
    if (same) {
      whenAlertClosed(() =>
        same.removedAt === null
          ? Alert.alert(`${same.name} staat er al`, 'Eén naam kan maar één keer in de ledenlijst staan.')
          : Alert.alert(
              `${same.name} is eerder weggehaald`,
              'Zet hem terug in plaats van hem opnieuw toe te voegen: dan blijft alles wat hij had op één regel.',
              [
                { text: 'Annuleren', style: 'cancel' },
                { text: 'Terugzetten', onPress: () => run(() => setRosterMemberRemoved(same.id, false)) },
              ]
            )
      );
      return;
    }
    void run(() => addRosterMembers(group.id, [{ id: newId(), name: name.trim().replace(/\s+/g, ' '), sectionId: null }]));
  };

  const memberRow = (member: RosterMember, isRemoved: boolean) => (
    <Card key={member.id} style={{ paddingVertical: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: isRemoved ? theme.textDim : theme.text,
              fontSize: 16,
              fontWeight: '600',
            }}>
            {member.name}
          </Text>
          {!isRemoved && admin && roster.sections.length > 0 ? (
            <Pressable onPress={() => setSectioning(member)} hitSlop={6}>
              <Text style={{ color: theme.link, fontSize: 12, marginTop: 2 }}>
                {sectionName(member.sectionId) ?? 'Geen speltak'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {admin && !isRemoved ? (
          <>
            <Pressable onPress={() => setRenaming(member)} hitSlop={8}>
              <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert(
                  `${member.name} weghalen?`,
                  'Hij staat dan niet meer in de keuzelijst. Wat er op rekeningen staat blijft.',
                  [
                    { text: 'Annuleren', style: 'cancel' },
                    {
                      text: 'Weghalen',
                      style: 'destructive',
                      onPress: () => run(() => setRosterMemberRemoved(member.id, true)),
                    },
                  ]
                )
              }
              hitSlop={8}>
              <Text style={{ color: theme.danger, fontWeight: '600' }}>Weghalen</Text>
            </Pressable>
          </>
        ) : null}
        {admin && isRemoved ? (
          <Pressable onPress={() => run(() => setRosterMemberRemoved(member.id, false))} hitSlop={8}>
            <Text style={{ color: theme.link, fontWeight: '600' }}>Terugzetten</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );

  // Per speltak, en wie bij geen enkele hoort onderaan.
  const groups: { key: string; title: string; members: RosterMember[] }[] = [
    ...roster.sections.map((section) => ({
      key: section.id,
      title: section.name,
      members: active.filter((member) => member.sectionId === section.id).sort(byName),
    })),
    {
      key: 'zonder',
      title: roster.sections.length > 0 ? 'Zonder speltak' : 'Leden',
      members: active.filter((member) => sectionName(member.sectionId) === null).sort(byName),
    },
  ].filter((entry) => entry.members.length > 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Ledenlijst' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 + bottomInset }}>
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
          Voor de hele groep ({group.name}). Wat je hier verandert, zien alle telefoons van de groep.
          {admin
            ? ''
            : ' Alleen een beheerder van de groep kan hier iets veranderen; op deze telefoon is het om te lezen.'}
          {busy ? ' Bezig…' : ''}
        </Text>

        {admin && plan.length > 0 ? (
          <Card style={{ gap: space.sm }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>
              Namen overnemen
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              {plan.length === 1 ? 'Er is 1 naam' : `Er zijn ${plan.length} namen`} op deze telefoon die
              nog niet in de ledenlijst staan: de Vaste namen
              {home ? ` en de leden van ${home.name}` : ''}. Dubbele namen tellen één keer, en de
              speltakken van de Vaste namen gaan mee.
            </Text>
            <Button
              title={plan.length === 1 ? '1 naam overnemen' : `${plan.length} namen overnemen`}
              onPress={adopt}
              disabled={busy}
            />
          </Card>
        ) : null}

        {groups.length === 0 ? (
          <EmptyState
            title="De ledenlijst is nog leeg"
            hint={admin ? 'Voeg namen toe, of neem ze over van deze telefoon.' : 'Een beheerder vult hem.'}
          />
        ) : (
          groups.map((entry) => (
            <View key={entry.key} style={{ gap: space.sm }}>
              <SectionTitle>{`${entry.title} · ${entry.members.length}`}</SectionTitle>
              {entry.members.map((member) => memberRow(member, false))}
            </View>
          ))
        )}

        {admin ? (
          <View style={{ gap: space.sm }}>
            <Button title="Naam toevoegen" variant="secondary" onPress={() => setAdding(true)} disabled={busy} />
          </View>
        ) : null}

        {removed.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionTitle>{`Weggehaald · ${removed.length}`}</SectionTitle>
            {removed.sort(byName).map((member) => memberRow(member, true))}
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <SectionTitle>Speltakken</SectionTitle>
          {roster.sections.length === 0 ? (
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              Nog geen speltakken. Met speltakken kies je aan de bar een hele groep in één tik.
            </Text>
          ) : (
            roster.sections.map((section) => (
              <Card key={section.id} style={{ paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 16, fontWeight: '600' }}>
                    {section.name}
                  </Text>
                  {admin ? (
                    <>
                      <Pressable onPress={() => setRenamingSection(section)} hitSlop={8}>
                        <Text style={{ color: theme.link, fontWeight: '600' }}>Hernoemen</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          Alert.alert(
                            `${section.name} verwijderen?`,
                            'De namen blijven in de ledenlijst staan; ze horen daarna bij geen speltak.',
                            [
                              { text: 'Annuleren', style: 'cancel' },
                              {
                                text: 'Verwijderen',
                                style: 'destructive',
                                onPress: () => run(() => removeRosterSection(section.id)),
                              },
                            ]
                          )
                        }
                        hitSlop={8}>
                        <Text style={{ color: theme.danger, fontWeight: '600' }}>Verwijderen</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </Card>
            ))
          )}
          {admin ? (
            <Button title="Speltak toevoegen" variant="secondary" onPress={() => setAddingSection(true)} disabled={busy} />
          ) : null}
        </View>
      </ScrollView>

      <PromptModal
        visible={adding}
        title="Naam toevoegen"
        placeholder="Volledige naam"
        submitLabel="Toevoegen"
        onCancel={() => setAdding(false)}
        onSubmit={addName}
      />

      <PromptModal
        visible={renaming !== null}
        title="Naam wijzigen"
        initialValue={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          const member = renaming;
          setRenaming(null);
          if (!member) return;
          const same = roster.members.find(
            (other) => other.id !== member.id && nameKey(other.name) === nameKey(name)
          );
          if (same) {
            whenAlertClosed(() =>
              Alert.alert(`${same.name} staat er al`, 'Eén naam kan maar één keer in de ledenlijst staan.')
            );
            return;
          }
          void run(() => renameRosterMember(member.id, name.trim().replace(/\s+/g, ' ')));
        }}
      />

      <PromptModal
        visible={addingSection}
        title="Speltak toevoegen"
        placeholder="bijv. Loodsenploeg"
        submitLabel="Toevoegen"
        onCancel={() => setAddingSection(false)}
        onSubmit={(name) => {
          setAddingSection(false);
          if (roster.sections.some((section) => nameKey(section.name) === nameKey(name))) return;
          void run(() => addRosterSection(group.id, newId(), name.trim()));
        }}
      />

      <PromptModal
        visible={renamingSection !== null}
        title="Speltak hernoemen"
        initialValue={renamingSection?.name ?? ''}
        onCancel={() => setRenamingSection(null)}
        onSubmit={(name) => {
          const section = renamingSection;
          setRenamingSection(null);
          if (section) void run(() => renameRosterSection(section.id, name.trim()));
        }}
      />

      <SectionPickerModal
        visible={sectioning !== null}
        title={sectioning ? `Speltak van ${sectioning.name}` : 'Speltak'}
        sections={roster.sections}
        value={sectioning?.sectionId ?? null}
        onCancel={() => setSectioning(null)}
        onSubmit={(sectionId) => {
          const member = sectioning;
          setSectioning(null);
          if (member) void run(() => setRosterMemberSection(member.id, sectionId));
        }}
      />
    </Screen>
  );
}
