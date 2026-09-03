/**
 * Scouting Jan Willem Friso colours.
 *
 * Taken from the group's own material rather than guessed:
 *  - #1A1B1F and #5D6C7B are the text colours in the site's stylesheet
 *  - #FFDA07 is the site's badge yellow, #7AE7FF its footer cyan
 *  - the teal-to-green pair is sampled straight out of the logo artwork
 *    (JWF_Icon_Green.png runs from #2EA0B2 through #40A982 to #55B663)
 *
 * One adjustment was needed. The logo's teal and green are bright: as a solid
 * button behind white text they only reach a contrast ratio of 2.5-3.1, well
 * under the 4.5 that small text needs to stay readable. The site never asks
 * them to do that -- its yellow badge and cyan footer both carry *dark* text.
 * So bright brand colours are used as surfaces under dark text, and a deepened
 * version of the same teal-green (#227A63) carries white text on buttons.
 * Every pairing below has been checked against WCAG AA.
 */

import { useColorScheme } from 'react-native';

/** The raw brand colours, kept separate so their origin stays obvious. */
export const brand = {
  teal: '#2EA0B2',
  tealGreen: '#40A982',
  green: '#55B663',
  cyan: '#7AE7FF',
  yellow: '#FFDA07',
  charcoal: '#393A3A',
  ink: '#1A1B1F',
} as const;

export type Theme = {
  background: string;
  card: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  onAccent: string;
  good: string;
  onGood: string;
  danger: string;
  onDanger: string;
  chip: string;
  highlight: string;
  onHighlight: string;
};

const light: Theme = {
  background: '#F4F6F5',
  card: '#FFFFFF',
  border: '#DFE5E2',
  text: brand.ink,
  textDim: '#5D6C7B',
  accent: '#227A63',
  onAccent: '#FFFFFF',
  good: '#1B7A3F',
  onGood: '#FFFFFF',
  danger: '#C62F3F',
  onDanger: '#FFFFFF',
  chip: '#E8EDEA',
  highlight: brand.yellow,
  onHighlight: brand.ink,
};

const dark: Theme = {
  background: '#12171A',
  card: '#1B2126',
  border: '#2A3238',
  text: '#EEF2F0',
  textDim: '#98A5AD',
  accent: '#4FBF9A',
  onAccent: '#0C1A15',
  good: brand.green,
  onGood: '#0A2011',
  danger: '#F4707F',
  onDanger: '#2A0A0E',
  chip: '#262E33',
  highlight: brand.yellow,
  onHighlight: brand.ink,
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Exported for the contrast check script; not used by the app at runtime. */
export const palettes = { light, dark };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/**
 * The group uses Montserrat for body text and Axis Extrabold for display.
 * Montserrat is loaded in the root layout; `bold` is used for headings and
 * amounts so numbers stay easy to scan.
 */
export const font = {
  regular: 'Montserrat_400Regular',
  medium: 'Montserrat_500Medium',
  semibold: 'Montserrat_600SemiBold',
  bold: 'Montserrat_700Bold',
} as const;
