/**
 * De bel van het rondje.
 *
 * Los van icons.tsx: dat bestand wordt gegenereerd uit de aangeleverde
 * tekeningen en mag niet met de hand worden aangepast. Dit is een eenvoudige
 * klokvorm, met de kleur van wie hem gebruikt.
 */

import Svg, { Path } from 'react-native-svg';

export function BellIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"
        fill={color}
      />
    </Svg>
  );
}
