import { useLocalSearchParams } from 'expo-router';

import { BeheerPage } from '@/components/beheer-page';

/** Beheer van één lijst. De pagina zelf staat in components/beheer-page.tsx. */
export default function BeheerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BeheerPage id={id} />;
}
