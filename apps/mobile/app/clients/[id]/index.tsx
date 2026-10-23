import { ConnectivityIndicator } from '@/components/connectivity-indicator';
import { Screen } from '@/components/screen';
import { VisitRow } from '@/components/visit-row';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { type VisitSummary, getClient, listClientVisits } from '@/api';
import { strings } from '@/lib/strings';
import type { Client } from '@barber/shared';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';

function newestFirst(visits: VisitSummary[]): VisitSummary[] {
  return [...visits].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export default function ClientScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [visits, setVisits] = useState<VisitSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  // What the device holds first, then the network's.
  const load = useCallback(async () => {
    setFailed(false);
    const showVisits = (history: VisitSummary[]) => setVisits(newestFirst(history));
    try {
      const [found, history] = await Promise.all([getClient(id, setClient), listClientVisits(id, showVisits)]);
      setClient(found);
      showVisits(history);
    } catch {
      setFailed(true);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (failed && !client) {
    return (
      <Screen className="items-center justify-center">
        <Text>{strings.client.loadFailed}</Text>
        <Button variant="outline" onPress={load}>
          <Text>{strings.client.retry}</Text>
        </Button>
      </Screen>
    );
  }

  return (
    <Screen className="pb-0">
      {client && (
        <View className="gap-1">
          <Text variant="h3">{client.name}</Text>
          <Text variant="muted">{client.phone ?? strings.client.noPhone}</Text>
        </View>
      )}
      <ConnectivityIndicator />
      <Button onPress={() => router.push({ pathname: '/clients/[id]/new-visit', params: { id } })}>
        <Text>{strings.client.newVisit}</Text>
      </Button>
      <FlatList
        data={visits ?? []}
        keyExtractor={(visit) => visit.id}
        ListHeaderComponent={<Text variant="large">{strings.client.visits}</Text>}
        renderItem={({ item }) => (
          <VisitRow
            visit={item}
            showClient={false}
            onPress={() =>
              router.push({
                // An open visit resumes at its photos; a closed one opens read-only.
                pathname: item.status === 'open' ? '/visits/[id]/photos' : '/visits/[id]/finish',
                params: { id: item.id },
              })
            }
          />
        )}
        ListEmptyComponent={visits ? <Text variant="muted">{strings.client.noVisits}</Text> : undefined}
      />
    </Screen>
  );
}
