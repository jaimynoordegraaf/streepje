import { useLocalSearchParams } from 'expo-router';

import { ListScreen } from '@/components/list-screen';

/** Een lijst die je vanuit het overzicht of een code opent. De inhoud staat in ListScreen. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ListScreen id={id} />;
}
