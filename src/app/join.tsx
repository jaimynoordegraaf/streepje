import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { PromptModal } from '@/components/modals';
import { Text } from '@/components/text';
import { Button, Card, Screen, useBottomInset } from '@/components/ui';
import { useStore } from '@/lib/store';
import { isSyncConfigured } from '@/lib/supabase';
import { fetchSession, joinSession } from '@/lib/sync';
import type { AppEvent } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

/**
 * Pull a join code out of whatever was scanned or typed.
 * Accepts the QR's `turf://join?code=K4P7QX` as well as a bare code.
 */
function codeFrom(raw: string): string | null {
  const text = raw.trim();
  const fromUrl = text.match(/code=([A-Z0-9]{4,12})/i);
  if (fromUrl) return fromUrl[1].toUpperCase();
  if (/^[A-Z0-9]{6}$/i.test(text)) return text.toUpperCase();
  return null;
}

export default function JoinScreen() {
  const theme = useTheme();
  const router = useRouter();
  const bottomInset = useBottomInset();
  const adoptRemoteEvent = useStore((state) => state.adoptRemoteEvent);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  // A QR in view fires continuously; this makes sure we only act on it once.
  const handled = useRef(false);

  const join = async (rawValue: string) => {
    const code = codeFrom(rawValue);
    if (!code) {
      handled.current = false;
      Alert.alert('Geen streepje-code', 'Deze code lijkt geen sessiecode te zijn.');
      return;
    }

    setBusy(true);
    try {
      const sessionId = await joinSession(code);
      const remote = await fetchSession(sessionId);

      const event: AppEvent = {
        id: sessionId,
        name: remote.name,
        createdAt: remote.createdAt,
        people: remote.people,
        menu: remote.menu,
        entries: remote.entries,
        unsyncedEntryIds: [],
        closed: remote.closed,
        share: { joinCode: code, role: 'guest', lastSyncedAt: Date.now() },
        // Guests never correct, so they hold no PIN. The host's PIN stays on
        // the host's phone and is not part of what a session syncs.
        correctionPin: null,
      };

      adoptRemoteEvent(event);
      router.replace({ pathname: '/event/[id]', params: { id: sessionId } });
    } catch (error) {
      handled.current = false;
      Alert.alert('Deelnemen mislukt', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    if (!isSyncConfigured) {
      return (
        <Card style={{ gap: space.sm }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Delen is nog niet ingesteld
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            Deze versie heeft geen servergegevens, dus er valt niets om aan deel te nemen. Zie
            supabase/README.md in het project voor de eenmalige instelling.
          </Text>
        </Card>
      );
    }

    if (busy) {
      return (
        <Card style={{ alignItems: 'center', gap: space.md }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={{ color: theme.textDim }}>Bezig met deelnemen…</Text>
        </Card>
      );
    }

    if (!permission) {
      return (
        <Card>
          <Text style={{ color: theme.textDim }}>Cameratoestemming controleren…</Text>
        </Card>
      );
    }

    if (!permission.granted) {
      return (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            Cameratoegang nodig
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            De camera wordt alleen gebruikt om de QR-code te lezen. Er wordt niets opgenomen of
            verstuurd.
          </Text>
          <Button title="Camera toestaan" onPress={requestPermission} />
          <Button title="Code intypen" variant="secondary" onPress={() => setTyping(true)} />
        </Card>
      );
    }

    return (
      <>
        <View
          style={{
            height: 320,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: '#000000',
          }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              handled.current = true;
              join(data);
            }}
          />
        </View>
        <Text style={{ color: theme.textDim, fontSize: 14, textAlign: 'center' }}>
          Richt de camera op de QR-code op de andere telefoon.
        </Text>
        <Button title="Code intypen" variant="secondary" onPress={() => setTyping(true)} />
      </>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Deelnemen aan sessie' }} />
      <View style={{ padding: space.lg, gap: space.lg, paddingBottom: space.lg + bottomInset }}>
        {body()}
      </View>

      <PromptModal
        visible={typing}
        title="Voer de code in"
        placeholder="bijv. K4P7QX"
        submitLabel="Deelnemen"
        onCancel={() => setTyping(false)}
        onSubmit={(value) => {
          setTyping(false);
          join(value);
        }}
      />
    </Screen>
  );
}
