# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# The slug stays "streeplijst"

`app.json` says `"name": "streepje"` but `"slug": "streeplijst"`. That is deliberate.
The slug is the identifier of the EAS project behind `extra.eas.projectId`, and Expo
does not let you rename a slug. Changing it to "streepje" makes every build fail with
"Slug ... does not match", and re-running `eas init` would hand out a new project with
a new Android keystore -- so the next APK could not install over the ones already on
people's phones. The user-facing name is `name`, not `slug`.

The Android package is `com.scoutingjwf.streepje`, not the `nl.` reverse of the
domain. Google Play locks the package to the app entry forever, so it is Play's
choice, not ours. Changing it orphans the app on Play.

# Every change works on Android and iOS

streepje ships to Google Play and to TestFlight, and Jaimy tests on both an iPhone and
an Android phone. A change is not done until it works on both platforms. Testing on one has
already hidden a failure on the other once: a PIN dialog opened from inside an
`Alert` button can fail to appear on iOS, and Android never shows the problem.

Before calling a change done:

- **Build both JavaScript bundles.** Both work on this Windows PC:
  `npx expo export --platform android` and `npx expo export --platform ios`.
- **Use only APIs that exist on both.** No `ToastAndroid`, `BackHandler`,
  `PermissionsAndroid`, `Alert.prompt` or `ActionSheetIOS`. Where the platforms
  genuinely differ, branch on `Platform.OS` and handle both sides, as the keyboard
  handling in `src/components/modals.tsx` does.
- **Open a modal from an `Alert` button through `whenAlertClosed`**, never directly.
- **Add only libraries that support both**, installed with `npx expo install` so the
  version matches the SDK. Check the platform table in the Expo docs first.
- **Handle both sides of `app.json`.** Permissions, icons, identifiers and plugin
  options each have an `ios` and an `android` side, and iOS needs a usage string
  for every permission it asks for.
- **Respect both safe areas:** the Android navigation bar (edge-to-edge is on) and the
  iPhone notch and home indicator. Bottom bars use `useBottomInset`.
- **Test on both phones:** the iPhone and the Android phone, each in Expo Go. When
  away from the PC's network, `npx expo start --tunnel --go` serves both at once,
  which also allows testing sync between the two platforms on one shared list.
- **Release both:** the Android bundle from `scripts/build-android-local.mjs`, and an
  EAS iOS build submitted to TestFlight.
