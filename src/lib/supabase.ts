/**
 * The connection to Supabase.
 *
 * Credentials come from environment variables, so they live in a .env file
 * that is not committed rather than being typed into the source. Expo exposes
 * any variable starting with EXPO_PUBLIC_ to the app.
 *
 * If they are missing the app still runs -- it simply stays local-only, and the
 * sharing screens explain what to set up. That keeps a missing key from
 * crashing an app someone is holding at a bar.
 */

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;

// Supabase is replacing the old "anon" key with a "publishable" key
// (sb_publishable_...). Both go in the same place and both work, so either
// variable name is accepted and the newer one wins when both are set.
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSyncConfigured = Boolean(url && anonKey);

/**
 * Storage is only attached when there is a real device or browser to store in.
 * Expo can also render the app in plain Node to pre-build web pages, and there
 * AsyncStorage reaches for window.localStorage and throws -- which took the
 * whole dev server down until this guard was added.
 */
const canPersistSession = typeof window !== 'undefined';

export const supabase = isSyncConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        storage: canPersistSession ? AsyncStorage : undefined,
        persistSession: canPersistSession,
        autoRefreshToken: canPersistSession,
        // Only relevant to websites, where the session arrives in the address bar.
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Every device signs in anonymously the first time it shares or joins.
 *
 * This is not a login: nobody types anything. It just gives the device an
 * identity the database can check, so a session's rows are readable only by
 * the devices that were actually invited to it.
 */
export async function ensureSignedIn(): Promise<string> {
  if (!supabase) throw new Error('Delen is niet ingesteld in deze versie.');

  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;

  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!created.session) throw new Error('Kon geen anonieme sessie starten.');
  return created.session.user.id;
}
