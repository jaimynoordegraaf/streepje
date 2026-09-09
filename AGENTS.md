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
