import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useStore } from '@/lib/store';
import { font, useTheme } from '@/theme';

/**
 * Loading saved data from storage takes a moment. Until it finishes the store
 * still holds its empty starting value, so we wait rather than briefly showing
 * "no events yet" to someone who has plenty.
 */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  useEffect(() => useStore.persist.onFinishHydration(() => setHydrated(true)), []);
  return hydrated;
}

export default function RootLayout() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const hydrated = useHydrated();
  // Each face is required by its exact path. Importing from the package index
  // instead pulls in all 18 weights and italics, and a single unresolved file
  // among them takes down the whole bundle.
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular: require('@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf'),
    Montserrat_500Medium: require('@expo-google-fonts/montserrat/500Medium/Montserrat_500Medium.ttf'),
    Montserrat_600SemiBold: require('@expo-google-fonts/montserrat/600SemiBold/Montserrat_600SemiBold.ttf'),
    Montserrat_700Bold: require('@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf'),
  });

  if (!hydrated || !fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.background,
        }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.card },
          headerTintColor: theme.text,
          headerTitleStyle: { color: theme.text, fontFamily: font.bold },
          contentStyle: { backgroundColor: theme.background },
        }}
      />
    </SafeAreaProvider>
  );
}
