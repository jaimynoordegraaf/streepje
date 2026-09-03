/**
 * Text in the group's typeface.
 *
 * Android does not synthesise bold for a custom font: asking for
 * `fontWeight: '700'` on Montserrat silently gives you the regular weight, or
 * a smeared fake bold. Each weight is a separate font family instead, so this
 * component reads the requested weight and swaps in the matching family.
 *
 * Use this everywhere in place of React Native's own Text.
 */

import { Text as RNText, StyleSheet, TextProps } from 'react-native';

import { font } from '@/theme';

function familyForWeight(weight: unknown): string {
  const numeric =
    weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight) || 400;
  if (numeric >= 700) return font.bold;
  if (numeric >= 600) return font.semibold;
  if (numeric >= 500) return font.medium;
  return font.regular;
}

export function Text({ style, ...rest }: TextProps) {
  const flattened = StyleSheet.flatten(style) ?? {};
  const { fontWeight, ...withoutWeight } = flattened;
  return <RNText {...rest} style={[withoutWeight, { fontFamily: familyForWeight(fontWeight) }]} />;
}
