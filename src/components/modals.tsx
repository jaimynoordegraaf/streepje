/**
 * Android has no built-in "ask for one line of text" dialog (iOS does, via
 * Alert.prompt), so these two small modals fill that gap.
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

import { Text } from '@/components/text';

import { centsToInput, parsePrice } from '@/lib/money';
import type { Category, MenuItem } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

import { Button, Field } from './ui';

function Backdrop({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          padding: space.lg,
        }}>
        {/* Pressing the card itself must not close the modal. */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.card,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.md,
          }}>
          {children}
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

export function PromptModal({
  visible,
  title,
  placeholder,
  initialValue = '',
  submitLabel = 'Opslaan',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initialValue);

  // Reset the field every time the modal is opened.
  useEffect(() => {
    if (visible) setText(initialValue);
  }, [visible, initialValue]);

  const submit = () => {
    if (text.trim() === '') return;
    onSubmit(text.trim());
  };

  // A closed modal is unmounted rather than left in place: otherwise its dark
  // backdrop stays in the tree and dims the screen behind it.
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>
        <Field
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          autoFocus
          onSubmitEditing={submit}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title={submitLabel}
            onPress={submit}
            disabled={text.trim() === ''}
            style={{ flex: 1 }}
          />
        </View>
      </Backdrop>
    </Modal>
  );
}

/** Add or edit a menu item: name, price and whether it is a drink or food. */
export function ItemFormModal({
  visible,
  item,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  /** Pass an existing item to edit it, or null to add a new one. */
  item: MenuItem | null;
  onCancel: () => void;
  onSubmit: (draft: Omit<MenuItem, 'id'>) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<Category>('drink');

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setPrice(item ? centsToInput(item.priceCents) : '');
    setCategory(item?.category ?? 'drink');
  }, [visible, item]);

  const priceCents = parsePrice(price);
  const valid = name.trim() !== '' && priceCents !== null;

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
          {item ? 'Item bewerken' : 'Nieuw item'}
        </Text>

        <Field value={name} onChangeText={setName} placeholder="Naam, bijv. Bier" autoFocus />
        <Field
          value={price}
          onChangeText={setPrice}
          placeholder="Prijs, bijv. 2,50"
          keyboardType="decimal-pad"
        />
        {price !== '' && priceCents === null ? (
          <Text style={{ color: theme.danger, fontSize: 13 }}>
            Dit is geen geldige prijs. Probeer bijvoorbeeld 2,50.
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {(['drink', 'food'] as Category[]).map((option) => {
            const selected = category === option;
            return (
              <Pressable
                key={option}
                onPress={() => setCategory(option)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: selected ? theme.accent : theme.chip,
                }}>
                <Text
                  style={{
                    color: selected ? theme.onAccent : theme.text,
                    fontWeight: '600',
                  }}>
                  {option === 'drink' ? 'Drankje' : 'Eten'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title="Opslaan"
            disabled={!valid}
            onPress={() =>
              onSubmit({ name: name.trim(), priceCents: priceCents ?? 0, category })
            }
            style={{ flex: 1 }}
          />
        </View>
      </Backdrop>
    </Modal>
  );
}
