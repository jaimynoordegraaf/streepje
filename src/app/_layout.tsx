import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BackIcon } from '@/components/icons';
import { useStore } from '@/lib/store';
import { font, space, type as typeScale, useTheme } from '@/theme';

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

/**
 * The back control, in the brand's own chevron.
 *
 * Returns null on the first screen: replacing headerLeft removes the native
 * back button, so without this check the root would show an arrow that has
 * nowhere to go.
 */
function HeaderBack() {
  const router = useRouter();
  const theme = useTheme();

  if (!router.canGoBack()) return null;

  return (
    <Pressable onPress={() => router.back()} hitSlop={14} style={{ paddingRight: space.md }}>
      <BackIcon size={20} color={theme.text} />
    </Pressable>
  );
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
    Montserrat_700Bold_Italic: require('@expo-google-fonts/montserrat/700Bold_Italic/Montserrat_700Bold_Italic.ttf'),
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

  /**
   * The navigation theme, which is not the same thing as ours.
   *
   * Without this the navigator runs on its light default whatever the phone is
   * set to. Painting headerStyle hid that for a long time, but it hid it only
   * from us: iOS still took the bar to be a light one, and from iOS 26 it
   * draws navigation bar buttons inside a Liquid Glass capsule built for the
   * bar it believes is underneath. A light capsule on a near-black bar is what
   * the back arrow was flashing.
   *
   * Telling the navigator which mode it is in settles both, and the standard
   * greys give way to the streepje palette while we are here.
   */
  const dark = scheme === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    dark,
    colors: {
      ...base.colors,
      primary: theme.accent,
      background: theme.background,
      card: theme.card,
      text: theme.text,
      border: theme.border,
      notification: theme.accent,
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ThemeProvider value={navigationTheme}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.card },
            headerTintColor: theme.text,
            // Bold italic, matching the logotype.
            headerTitleStyle: {
              color: theme.text,
              fontFamily: font.displayItalic,
              fontSize: typeScale.title,
            },
            contentStyle: { backgroundColor: theme.background },
            headerLeft: () => <HeaderBack />,
          }}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
