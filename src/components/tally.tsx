/**
 * Een rijtje streepjes, zoals op de papieren streeplijst: vier rechtop en de
 * vijfde er schuin doorheen, in groepjes van vijf naast elkaar.
 *
 * Getekend als vector, zoals de iconen: scherp op elke dichtheid en in elke
 * kleur. Een groep die vol is krijgt zijn schuine streep; de laatste groep
 * heeft alleen de streepjes die er zijn.
 */

import { View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

const HEIGHT = 22;
const GAP = 6;
const STROKE = 2.4;

function Group({ marks, color }: { marks: number; color: string }) {
  const full = marks === 5;
  const width = full ? 6 * 4 + 4 : GAP * marks + 2;
  return (
    <Svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
      {Array.from({ length: Math.min(marks, 4) }, (_, index) => (
        <Line
          key={index}
          x1={3 + index * GAP}
          y1={2}
          x2={3 + index * GAP}
          y2={HEIGHT - 2}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
      ))}
      {full ? (
        <Line
          x1={1}
          y1={HEIGHT - 5}
          x2={width - 1}
          y2={5}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
      ) : null}
    </Svg>
  );
}

export function Tally({ count, color }: { count: number; color: string }) {
  const marks = Math.max(0, Math.floor(count));
  if (marks === 0) return null;

  const groups = Math.ceil(marks / 5);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: groups }, (_, index) => (
        <Group
          key={index}
          marks={index === groups - 1 ? marks - index * 5 : 5}
          color={color}
        />
      ))}
    </View>
  );
}
