// Build a signed release AAB on this machine instead of on EAS.
//
// The free EAS tier queues for an hour or more, which is a long time to wait
// to find out a config field was wrong. This does the same work locally:
// prebuild the native project, sign it with the upload key, run Gradle.
//
// It never touches the EAS setup. `android/` is generated and gitignored, so
// everything this writes there is thrown away by the next prebuild.
//
//   node scripts/build-android-local.mjs [--clean] [--version-code=N]
//
// Needs a JDK 17 and an Android SDK. Point JAVA_HOME and ANDROID_HOME at them,
// or put them in %USERPROFILE%/dev/ as jdk-* and android-sdk.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BACKSLASH = String.fromCharCode(92);

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const clean = args.includes('--clean');
const versionCodeArg = args.find((a) => a.startsWith('--version-code=')) ?? '--version-code=2';
const versionCode = Number(versionCodeArg.split('=')[1]);

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

if (!Number.isInteger(versionCode) || versionCode < 1) {
  fail('--version-code must be a whole number, got ' + versionCodeArg.split('=')[1]);
}

function firstExisting(candidates) {
  return candidates.find((c) => c && fs.existsSync(c));
}

// A JDK and an SDK, from the environment or from the usual spot.
const dev = path.join(os.homedir(), 'dev');
const jdkGuess = fs.existsSync(dev)
  ? fs
      .readdirSync(dev)
      .filter((name) => name.startsWith('jdk-'))
      .sort()
      .reverse()
      .map((name) => path.join(dev, name))
  : [];
const javaHome = firstExisting([process.env.JAVA_HOME, ...jdkGuess]);
const androidHome = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(dev, 'android-sdk'),
]);

if (!javaHome) {
  fail('No JDK found. Set JAVA_HOME, or unpack a JDK 17 into %USERPROFILE%/dev/jdk-17...');
}
if (!androidHome) {
  fail('No Android SDK found. Set ANDROID_HOME, or unpack one into %USERPROFILE%/dev/android-sdk');
}

// The upload key. This is the same key EAS signs with, so a build from here and
// a build from EAS stay interchangeable as far as Play is concerned.
const keystore = path.join(root, 'signing', 'upload.jks');
const credsFile = path.join(root, 'signing', 'upload.json');
if (!fs.existsSync(keystore) || !fs.existsSync(credsFile)) {
  fail(
    'Missing signing/upload.jks and signing/upload.json.\n' +
      'Export them from EAS with: eas credentials --platform android\n' +
      'They are gitignored on purpose. Losing the key means Play stops accepting uploads.'
  );
}
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));

// Play enrols one upload certificate per listing and rejects anything signed
// with another, so check the key before spending twelve minutes on a bundle
// that cannot be uploaded. The expected fingerprint is in the rejection message
// Play shows, and in signing/upload.json.
function fingerprintOf(keystorePath) {
  const listed = execFileSync(
    path.join(javaHome, 'bin', 'keytool.exe'),
    ['-list', '-v', '-keystore', keystorePath, '-storepass', creds.storePassword, '-alias', creds.keyAlias],
    { encoding: 'utf8' }
  );
  const match = listed.match(/SHA1:\s*([0-9A-F:]+)/);
  return match ? match[1] : null;
}

const sha1 = fingerprintOf(keystore);
if (creds.expectedSha1 && sha1 && sha1 !== creds.expectedSha1) {
  fail(
    'signing/upload.jks is not the key Play expects.\n' +
      '  expected ' + creds.expectedSha1 + '\n' +
      '  found    ' + sha1 + '\n' +
      'Play rejects a bundle signed with any other key. Export the right one from EAS.'
  );
}

console.log('JDK          ' + javaHome);
console.log('Android SDK  ' + androidHome);
console.log('versionCode  ' + versionCode + '\n');

function run(command, commandArgs, options = {}) {
  console.log('> ' + path.basename(command) + ' ' + commandArgs.join(' '));
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    ...options,
  });
  if (result.status !== 0) {
    fail(path.basename(command) + ' failed with code ' + result.status);
  }
}

function replaceOnce(source, pattern, replacement, what) {
  const out = source.replace(pattern, replacement);
  if (out === source) {
    fail(
      'Could not patch the ' + what + ' in android/app/build.gradle.\n' +
        'The Expo template changed shape. Read the file and update this script.'
    );
  }
  return out;
}

// 1. Generate android/ from app.json.
const prebuild = ['expo', 'prebuild', '--platform', 'android', '--no-install'];
if (clean) prebuild.push('--clean');
run('npx', prebuild);

const androidDir = path.join(root, 'android');
const appDir = path.join(androidDir, 'app');

// 2. Tell Gradle where the SDK is. A backslash escapes in .properties files, so
//    a Windows path has to be written with each one doubled.
const sdkDir = androidHome.split(BACKSLASH).join(BACKSLASH + BACKSLASH);
fs.writeFileSync(path.join(androidDir, 'local.properties'), 'sdk.dir=' + sdkDir + '\n');

// 3. Put the key where Gradle expects it and hand it the passwords.
fs.copyFileSync(keystore, path.join(appDir, 'upload.jks'));
fs.appendFileSync(
  path.join(androidDir, 'gradle.properties'),
  [
    '',
    '# Written by scripts/build-android-local.mjs',
    'UPLOAD_STORE_FILE=upload.jks',
    'UPLOAD_STORE_PASSWORD=' + creds.storePassword,
    'UPLOAD_KEY_ALIAS=' + creds.keyAlias,
    'UPLOAD_KEY_PASSWORD=' + creds.keyPassword,
    '',
  ].join('\n')
);

// 4. The generated build.gradle signs release with the *debug* key, which Play
//    rejects. Give it a real release config instead.
const buildGradlePath = path.join(appDir, 'build.gradle');
let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');

const releaseSigningConfig = [
  '',
  '        release {',
  '            storeFile file(UPLOAD_STORE_FILE)',
  '            storePassword UPLOAD_STORE_PASSWORD',
  '            keyAlias UPLOAD_KEY_ALIAS',
  '            keyPassword UPLOAD_KEY_PASSWORD',
  '        }',
].join('\n');

buildGradle = replaceOnce(
  buildGradle,
  'signingConfigs {',
  'signingConfigs {' + releaseSigningConfig,
  'signingConfigs block'
);

// `signingConfig signingConfigs.debug` appears twice: once for the debug build
// type, which is correct, and once for release, which is not. Only the second
// one moves.
let seen = 0;
buildGradle = buildGradle.replace(/signingConfig signingConfigs\.debug/g, (match) => {
  seen += 1;
  return seen === 2 ? 'signingConfig signingConfigs.release' : match;
});
if (seen !== 2) {
  fail(
    'Expected two debug signingConfig lines in android/app/build.gradle, found ' + seen + '.\n' +
      'The Expo template changed shape. Read the file and update this script.'
  );
}

buildGradle = replaceOnce(
  buildGradle,
  /versionCode \d+/,
  'versionCode ' + versionCode,
  'versionCode'
);

fs.writeFileSync(buildGradlePath, buildGradle);

// 5. Build.
run(path.join(androidDir, 'gradlew.bat'), ['bundleRelease'], {
  cwd: androidDir,
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome },
});

const aab = path.join(appDir, 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!fs.existsSync(aab)) {
  fail('Gradle finished but there is no bundle at ' + aab);
}

// 6. Say what came out, so the wrong file does not get uploaded.
const size = (fs.statSync(aab).size / 1024 / 1024).toFixed(1);
console.log('\n' + aab);
console.log(size + ' MB, versionCode ' + versionCode);
if (sha1) console.log('signed with SHA1 ' + sha1);
