/**
 * De testversie krijgt een eigen naam en eigen id, de winkelversie niets.
 *
 * Een development build is dezelfde app met dezelfde bundle-id als die uit de
 * winkel, maar anders ondertekend, en dan weigert iOS hem ernaast te zetten:
 * "streepje is al geinstalleerd". Verwijderen is geen optie -- dan gaat ook
 * alles weg wat alleen op die telefoon staat, zoals de correctiecodes van de
 * lijsten die hij host.
 *
 * Met een eigen id staan ze naast elkaar. De testversie heet "streepje (dev)"
 * zodat op het beginscherm meteen te zien is welke van de twee je opent, en
 * omdat hij een eigen id heeft heeft hij ook zijn eigen opslag: wat je in de
 * testversie doet raakt de echte lijsten niet.
 *
 * Alles staat nog in app.json; Expo leest dat eerst en geeft het hier mee als
 * `config`. Zonder APP_VARIANT=development gaat het er onveranderd weer uit,
 * dus een winkelbuild ziet precies wat hij altijd zag. Die vlag staat in
 * eas.json, alleen in het development-profiel.
 */

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') return config;

  return {
    ...config,
    name: 'streepje (dev)',
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.dev` },
    android: { ...config.android, package: `${config.android.package}.dev` },
  };
};
