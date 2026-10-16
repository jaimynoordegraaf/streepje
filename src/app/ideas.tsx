/**
 * Ideeën voor de app, ingestuurd vanaf de bar.
 *
 * De mensen die ermee werken bedenken de verbeteringen. Die gingen eerder via
 * een appje of mondeling, en zakten dan weg. Een idee hoort bij de groep: de
 * hele ploeg ziet wat er al bedacht is, dus niemand stuurt hetzelfde twee keer
 * in en iedereen ziet dat er iets mee gebeurt.
 *
 * Wat erbij gaat is de naam van de telefoon, de versie en het platform. Geen
 * persoonsgegevens -- de app kent telefoons, geen mensen -- maar wel genoeg om
 * "dat knopje doet het niet" te kunnen plaatsen.
 */

import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, View } from 'react-native';

import { Text } from '@/components/text';
import { Button, Card, EmptyState, Field, Screen, useBottomInset } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { formatDateTime } from '@/lib/export';
import { newId, useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { deleteIdea, fetchIdeas, submitIdea, type Idea } from '@/lib/sync';
import { appVersion } from '@/lib/version';
import { space, useTheme } from '@/theme';

export default function IdeasScreen() {
  const theme = useTheme();
  const group = useStore((state) => state.group);
  const deviceName = useStore((state) => state.deviceName);
  const bottomInset = useBottomInset();

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSyncConfigured) return;
    setLoading(true);
    try {
      setIdeas(await fetchIdeas(group?.id ?? null));
      setFailed(null);
    } catch (error) {
      setFailed(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [group]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const send = async () => {
    const body = draft.trim();
    if (body === '' || busy) return;
    setBusy(true);
    try {
      await submitIdea({
        id: newId(),
        body,
        groupId: group?.id ?? null,
        deviceName,
        appVersion: appVersion(),
        platform: Platform.OS,
      });
      setDraft('');
      await load();
    } catch (error) {
      Alert.alert('Versturen mislukt', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (idea: Idea) =>
    Alert.alert('Dit idee terugtrekken?', idea.body, [
      { text: 'Annuleren', style: 'cancel' },
      {
        text: 'Terugtrekken',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteIdea(idea.id);
            await load();
          } catch (error) {
            Alert.alert('Terugtrekken mislukt', describeError(error));
          }
        },
      },
    ]);

  if (!isSyncConfigured) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Ideeën' }} />
        <EmptyState
          title="Delen is niet ingesteld"
          hint="Zonder servergegevens kan deze versie geen ideeën versturen."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Ideeën' }} />

      <FlatList
        data={ideas}
        keyExtractor={(idea) => idea.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl + bottomInset }}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.sm }}>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 19 }}>
              {group
                ? `Wat hier staat ziet iedereen van ${group.name}. Je eigen inzending kun je terugtrekken.`
                : 'Zonder groep zie je alleen je eigen ideeën. Sluit je aan bij een groep onder Instellingen om ze met de ploeg te delen.'}
            </Text>
            <Field
              value={draft}
              onChangeText={setDraft}
              placeholder="Wat zou de app moeten kunnen? Hoe concreter, hoe beter."
              multiline
            />
            <Button
              title={busy ? 'Bezig…' : 'Idee insturen'}
              disabled={busy || draft.trim() === ''}
              onPress={send}
            />
            {failed ? (
              <Text style={{ color: theme.danger, fontSize: 13 }}>
                Ophalen mislukt: {failed}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item: idea }) => (
          <Card style={{ gap: space.xs }}>
            <Text style={{ color: theme.text, fontSize: 15, lineHeight: 21 }}>{idea.body}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={{ flex: 1, color: theme.textDim, fontSize: 12 }}>
                {[
                  idea.deviceName ?? 'onbekende telefoon',
                  formatDateTime(idea.createdAt),
                  idea.appVersion ? 'v' + idea.appVersion : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {idea.mine ? (
                <Pressable onPress={() => confirmDelete(idea)} hitSlop={8}>
                  <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>
                    Terugtrekken
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
        )}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title="Nog geen ideeën"
              hint="Valt je iets op achter de bar, zet het hierboven neer. Ook kleine dingen."
            />
          )
        }
      />
    </Screen>
  );
}
