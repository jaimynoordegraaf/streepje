/**
 * Asking for the correction PIN, and choosing one.
 *
 * Two modes rather than one screen that tries to be both:
 *   verify -- prove you know the PIN before a turf is removed
 *   set    -- choose a new PIN, typed twice so a slip cannot lock you out
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';

import {
  PIN_LENGTH,
  clearWrongPins,
  createPinRecord,
  isValidPinFormat,
  lockedForSeconds,
  noteWrongPin,
  verifyPin,
} from '@/lib/pin';
import type { PinRecord } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

import { Text } from './text';
import { Button } from './ui';

function PinField({
  value,
  onChangeText,
  autoFocus = false,
  editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChangeText(text.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      keyboardType="number-pad"
      secureTextEntry
      autoFocus={autoFocus}
      editable={editable}
      maxLength={PIN_LENGTH}
      style={{
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: radius.md,
        paddingVertical: 14,
        fontSize: 28,
        letterSpacing: 14,
        textAlign: 'center',
        color: theme.text,
        opacity: editable ? 1 : 0.5,
      }}
    />
  );
}

export function PinModal({
  visible,
  mode,
  eventId,
  record,
  title,
  explanation,
  onCancel,
  onVerified,
  onSet,
}: {
  visible: boolean;
  mode: 'verify' | 'set';
  eventId: string;
  /** Required in verify mode. */
  record?: PinRecord | null;
  title: string;
  explanation?: string;
  onCancel: () => void;
  onVerified?: () => void;
  onSet?: (record: PinRecord) => void;
}) {
  const theme = useTheme();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setFirst('');
    setSecond('');
    setError(null);
    setBusy(false);
    setWait(lockedForSeconds(eventId));
  }, [visible, eventId]);

  // Count the lockout down while the dialog is open.
  useEffect(() => {
    if (!visible || wait <= 0) return;
    const timer = setInterval(() => setWait(lockedForSeconds(eventId)), 1000);
    return () => clearInterval(timer);
  }, [visible, wait, eventId]);

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (mode === 'set') {
      if (!isValidPinFormat(first)) return setError(`Kies ${PIN_LENGTH} cijfers.`);
      if (first !== second) return setError('De twee codes zijn niet gelijk.');
      setBusy(true);
      try {
        onSet?.(await createPinRecord(first));
      } catch (failure) {
        // Hashing runs in native code and can fail. Say so, rather than
        // leaving the dialog sitting there with a button that does nothing.
        setError('Opslaan mislukt: ' + (failure instanceof Error ? failure.message : String(failure)));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (wait > 0) return;
    if (!record) return setError('Er is nog geen pincode ingesteld.');
    if (!isValidPinFormat(first)) return setError(`Voer ${PIN_LENGTH} cijfers in.`);

    setBusy(true);
    let ok = false;
    try {
      ok = await verifyPin(first, record);
    } catch (failure) {
      setBusy(false);
      setError('Controle mislukt: ' + (failure instanceof Error ? failure.message : String(failure)));
      return;
    }
    setBusy(false);

    if (ok) {
      clearWrongPins(eventId);
      onVerified?.();
      return;
    }

    noteWrongPin(eventId);
    const locked = lockedForSeconds(eventId);
    setWait(locked);
    setFirst('');
    setError(locked > 0 ? `Onjuiste pincode. Wacht ${locked} seconden.` : 'Onjuiste pincode.');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
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
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.card,
              borderRadius: radius.lg,
              padding: space.lg,
              gap: space.md,
            }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>

            {explanation ? (
              <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
                {explanation}
              </Text>
            ) : null}

            <PinField value={first} onChangeText={setFirst} autoFocus editable={wait === 0} />

            {mode === 'set' ? (
              <>
                <Text style={{ color: theme.textDim, fontSize: 13 }}>Nogmaals ter controle</Text>
                <PinField value={second} onChangeText={setSecond} />
              </>
            ) : null}

            {error ? (
              <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
            ) : null}

            {wait > 0 ? (
              <Text style={{ color: theme.danger, fontSize: 13 }}>
                Te veel pogingen. Nog {wait} seconden wachten.
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
              <Button
                title={mode === 'set' ? 'Opslaan' : 'Bevestigen'}
                onPress={submit}
                disabled={busy || wait > 0}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
