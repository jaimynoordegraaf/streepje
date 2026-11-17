/**
 * Een naam typen en voorstellen krijgen.
 *
 * Je typt, en uit de namen die er al zijn verschijnen tot vijf voorstellen, ook
 * bij een tikfout. Een tik op een voorstel is de keuze. Staat de naam er echt niet
 * bij, dan staat onder het veld een knop om hem als nieuw lid toe te voegen.
 *
 * Wie al op de lijst staat, of eerder is verwijderd, staat er ook tussen maar is
 * grijs: zo is het meteen duidelijk waarom je niet nog een Jan krijgt.
 *
 * Alles hier gebeurt op het toestel, op de namen die het al heeft. Er wordt niets
 * opgezocht bij anderen, en er zit geen namenlijst in de app zelf.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Backdrop } from '@/components/modals';
import { Text } from '@/components/text';
import { Button, Field } from '@/components/ui';
import { nameKey, suggestNames } from '@/lib/names';
import { space, radius, useTheme } from '@/theme';

export type NameCandidate = {
  id: string;
  name: string;
  /** Bij welke speltak hij hoort, om erbij te zetten. */
  section: string | null;
  /**
   * Waarom hij niet te kiezen is: "staat al op de lijst" of "eerder verwijderd".
   * Null als hij gekozen kan worden.
   */
  blocked: string | null;
};

export function NameSuggestModal({
  visible,
  candidates,
  onPick,
  onNew,
  onCancel,
}: {
  visible: boolean;
  candidates: NameCandidate[];
  onPick: (candidate: NameCandidate) => void;
  /** Een naam die er nog niet is, zoals getypt (zonder dubbele spaties). */
  onNew: (name: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  if (!visible) return null;

  const typed = text.trim().replace(/\s+/g, ' ');
  const suggestions = suggestNames(typed, candidates);
  // Staat precies deze naam er al, dan is "nieuw" er een tweede van.
  const exists = typed !== '' && candidates.some((candidate) => nameKey(candidate.name) === nameKey(typed));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Lid toevoegen</Text>

        <Field
          value={text}
          onChangeText={setText}
          placeholder="Naam"
          autoFocus
        />

        <View style={{ gap: space.xs }}>
          {suggestions.map((candidate) => (
            <Pressable
              key={candidate.id}
              disabled={candidate.blocked !== null}
              onPress={() => onPick(candidate)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingVertical: 12,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                backgroundColor: theme.chip,
                opacity: candidate.blocked !== null ? 0.5 : 1,
              }}>
              <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
                {candidate.name}
              </Text>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>
                {candidate.blocked ?? candidate.section ?? ''}
              </Text>
            </Pressable>
          ))}
          {typed !== '' && suggestions.length === 0 ? (
            <Text style={{ color: theme.textDim, fontSize: 13 }}>Geen voorstel gevonden.</Text>
          ) : null}
        </View>

        {typed !== '' && !exists ? (
          <Button title={`"${typed}" als nieuw lid toevoegen`} onPress={() => onNew(typed)} />
        ) : null}

        <Button title="Annuleren" variant="secondary" onPress={onCancel} />
      </Backdrop>
    </Modal>
  );
}
