/**
 * Which code this phone is running, as one line for the bottom of Instellingen.
 *
 * With over-the-air updates the store version alone no longer says what is on a
 * phone: two phones on 1.0.3 can be running different updates. This line makes
 * that visible. It is how you check that an update arrived, and the first thing
 * to ask for when someone reports a problem.
 */

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { formatDateTime } from './export';

export function versionLine(): string {
  const version = Constants.expoConfig?.version ?? Updates.runtimeVersion ?? '?';
  const parts = ['Versie ' + version];

  if (!Updates.isEnabled) {
    // Expo Go and development builds, where updates are switched off.
    parts.push('ontwikkelversie');
  } else if (Updates.isEmbeddedLaunch) {
    // The code that shipped inside the store build: no update has been applied.
    parts.push('uit de winkel');
  } else {
    // When the running update was published, which tells two updates apart.
    parts.push(Updates.createdAt ? 'update ' + formatDateTime(Updates.createdAt.getTime()) : 'update');
  }

  // A downloaded update failed to start, and the build's own code ran instead.
  if (Updates.isEmergencyLaunch) parts.push('noodstart');

  return parts.join(' · ');
}
