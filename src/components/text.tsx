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

function familyFor(weight: unknown, italic: boolean): string {
  const numeric =
    weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight) || 400;

  // Only the display face has an italic cut loaded, so italic implies bold.
  if (italic) return font.displayItalic;

  if (numeric >= 700) return font.bold;
  if (numeric >= 600) return font.semibold;
  if (numeric >= 500) return font.medium;
  return font.regular;
}

export function Text({ style, ...rest }: TextProps) {
  const flattened = StyleSheet.flatten(style) ?? {};
  // Both are dropped and expressed as a family instead: leaving them in makes
  // Android fake a slant or a weight on top of an already-correct face.
  const { fontWeight, fontStyle, ...rest2 } = flattened;
  return (
    <RNText
      // The phone's own text-size setting is respected, but bounded. Android
      // allows well past 2x, which no fixed layout survives; the screens adapt
      // up to this point and stop there. Pass the prop to override per case.
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[rest2, { fontFamily: familyFor(fontWeight, fontStyle === 'italic') }]}
    />
  );
}
