/**
 * The streepje house style.
 *
 * Colours, typeface and type scale come from the brand sheet. Two adjustments
 * were needed, both for the same reason the sheet already gives.
 *
 * The sheet notes that the pale tints need black text "voor betere
 * leesbaarheid". Measured, the full-strength colours need it too: behind white
 * text the orange reaches only 3.37 contrast and the blue 2.55, against the 4.5
 * that small text needs. Behind black they are fine (5.37 and 7.10). So the
 * brand colours are used as surfaces carrying dark text, never as a bed for
 * white text.
 *
 * Those same colours also fail as small text on white, so anything that is text
 * rather than a surface -- links, amounts, warnings -- uses a deepened version.
 * The bright orange still appears at full strength where it is a large glyph or
 * a filled button, which is what it was designed for.
 *
 * Every pairing below is checked against WCAG AA.
 */

import { useColorScheme } from 'react-native';

/** The palette exactly as drawn on the brand sheet. */
export const brand = {
  ink: '#161616',
  blue: '#41AAF1',
  orange: '#F15A24',
  blueTint: '#A9E0FF',
  orangeTint: '#FFB69F',
} as const;

export type Theme = {
  background: string;
  card: string;
  border: string;
  text: string;
  textDim: string;
  /** Filled buttons and the + control: brand orange under a dark label. */
  accent: string;
  onAccent: string;
  /** Orange and blue are not legible as small text, so links use a deeper tone. */
  link: string;
  good: string;
  onGood: string;
  danger: string;
  onDanger: string;
  chip: string;
  /** Pale tint for badges, always under dark text as the sheet specifies. */
  highlight: string;
  onHighlight: string;
};

const light: Theme = {
  background: '#F5F5F6',
  card: '#FFFFFF',
  border: '#E3E3E6',
  text: brand.ink,
  textDim: '#5C5C60',
  accent: brand.orange,
  onAccent: brand.ink,
  link: '#1F6FA8',
  good: '#1F6FA8',
  onGood: '#FFFFFF',
  danger: '#C8410F',
  onDanger: '#FFFFFF',
  chip: '#EDEDEF',
  highlight: brand.orangeTint,
  onHighlight: brand.ink,
};

const dark: Theme = {
  background: '#0F0F10',
  card: '#1C1C1E',
  border: '#2C2C30',
  text: '#F2F2F3',
  textDim: '#9A9AA0',
  accent: brand.orange,
  onAccent: brand.ink,
  link: '#6CC0F7',
  good: '#6CC0F7',
  onGood: '#0D1A22',
  danger: '#FF7A4D',
  onDanger: '#2A0D05',
  chip: '#262629',
  highlight: brand.orangeTint,
  onHighlight: brand.ink,
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const palettes = { light, dark };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/**
 * Montserrat, as the sheet specifies, with the display face in bold italic to
 * match the logotype.
 *
 * Android does not synthesise weights or slant for a custom font -- each one is
 * a separate family. See components/text.tsx.
 */
export const font = {
  regular: 'Montserrat_400Regular',
  medium: 'Montserrat_500Medium',
  semibold: 'Montserrat_600SemiBold',
  bold: 'Montserrat_700Bold',
  displayItalic: 'Montserrat_700Bold_Italic',
} as const;

/**
 * Type scale, stepped by the golden ratio the sheet calls for ("gedeeld door
 * 1,618"): 15 -> 24 -> 39.
 *
 * `small` sits off the scale on purpose. Continuing downwards gives 9.3pt,
 * which is too small to read at arm's length on a phone in a dim room, and
 * this app is used standing at a bar.
 */
export const type = {
  display: 39,
  title: 24,
  body: 15,
  small: 12,
} as const;
