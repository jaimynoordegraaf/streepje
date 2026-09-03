/**
 * Editing a list of drinks and food. Used both for an event's own menu and for
 * the default menu in Settings, so the two behave identically.
 */

import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { formatCents } from '@/lib/money';
import type { Category, MenuItem } from '@/lib/types';
import { space, useTheme } from '@/theme';

import { ItemFormModal } from './modals';
import { Button, Card, EmptyState, SectionTitle } from './ui';

export function MenuEditor({
  items,
  onAdd,
  onUpdate,
  onRemove,
  /** Optional extra warning shown before deleting, e.g. "3 already logged". */
  removeWarning,
}: {
  items: MenuItem[];
  onAdd: (draft: Omit<MenuItem, 'id'>) => void;
  onUpdate: (itemId: string, patch: Partial<Omit<MenuItem, 'id'>>) => void;
  onRemove: (itemId: string) => void;
  removeWarning?: (item: MenuItem) => string | null;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const confirmRemove = (item: MenuItem) => {
    const warning = removeWarning?.(item);
    Alert.alert(
      `Remove ${item.name}?`,
      warning ?? undefined,
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Verwijderen', style: 'destructive', onPress: () => onRemove(item.id) },
      ]
    );
  };

  const group = (title: string, category: Category) => {
    const groupItems = items.filter((item) => item.category === category);
    if (groupItems.length === 0) return null;

    return (
      <View style={{ gap: space.sm }}>
        <SectionTitle>{title}</SectionTitle>
        {groupItems.map((item) => (
          <Card key={item.id} style={{ paddingVertical: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
                  {item.name}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
                  {formatCents(item.priceCents)}
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  setEditing(item);
                  setFormOpen(true);
                }}
                hitSlop={8}>
                <Text style={{ color: theme.accent, fontWeight: '600' }}>Bewerken</Text>
              </Pressable>
              <Pressable onPress={() => confirmRemove(item)} hitSlop={8}>
                <Text style={{ color: theme.danger, fontWeight: '600' }}>Verwijderen</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </View>
    );
  };

  return (
    <View style={{ gap: space.lg }}>
      {items.length === 0 ? (
        <EmptyState title="Nog geen items" hint="Voeg de drankjes en het eten toe dat je wilt turven." />
      ) : null}

      {group('Drankjes', 'drink')}
      {group('Eten', 'food')}

      <Button
        title="Item toevoegen"
        variant="secondary"
        onPress={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      <ItemFormModal
        visible={formOpen}
        item={editing}
        onCancel={() => setFormOpen(false)}
        onSubmit={(draft) => {
          if (editing) onUpdate(editing.id, draft);
          else onAdd(draft);
          setFormOpen(false);
        }}
      />
    </View>
  );
}
