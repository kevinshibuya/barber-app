import { Screen } from '@/components/screen';
import { VisitRow } from '@/components/visit-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { type VisitSummary, listRecentVisits, searchClients, signOut } from '@/api';
import { strings } from '@/lib/strings';
import type { Client } from '@barber/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

// A search starts at two letters, once typing pauses.
const MIN_QUERY_LENGTH = 2;
const SEARCH_DELAY_MS = 200;

// The clients matching the query; a result is shown only for the query it answers.
function useClientSearch(query: string) {
  const needle = query.trim();
  const [result, setResult] = useState<{ needle: string; clients: Client[] | null } | null>(null);

  useEffect(() => {
    if (needle.length < MIN_QUERY_LENGTH) return;
    let current = true;
    const timer = setTimeout(() => {
      searchClients(needle).then(
        (clients) => current && setResult({ needle, clients }),
        () => current && setResult({ needle, clients: null }),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [needle]);

  const answered = result?.needle === needle ? result : null;
  return {
    searching: needle.length >= MIN_QUERY_LENGTH,
    clients: answered?.clients ?? null,
    failed: answered !== null && answered.clients === null,
  };
}

function useRecentVisits() {
  const [visits, setVisits] = useState<VisitSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setVisits(await listRecentVisits());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Reloaded each time home comes back into view, so a visit just closed shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { visits, failed, refreshing, refresh };
}

export default function HomeScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const search = useClientSearch(query);
  const recent = useRecentVisits();

  async function leave() {
    await signOut().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <Screen className="pb-0">
      <View className="flex-row items-center gap-2">
        <Input
          accessibilityLabel={strings.home.search}
          placeholder={strings.home.search}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          className="flex-1"
        />
        <Button onPress={() => router.push('/clients/new')}>
          <Text>{strings.home.newClient}</Text>
        </Button>
      </View>
      {search.searching ? (
        <FlatList
          data={search.clients ?? []}
          keyExtractor={(client) => client.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/clients/[id]', params: { id: item.id } })}
              className="active:bg-accent border-border border-b py-3"
            >
              <Text className="font-medium">{item.name}</Text>
              {item.phone && <Text variant="muted">{item.phone}</Text>}
            </Pressable>
          )}
          ListEmptyComponent={
            search.failed ? (
              <Text variant="muted">{strings.home.loadFailed}</Text>
            ) : search.clients ? (
              <Text variant="muted">{strings.home.noClients}</Text>
            ) : undefined
          }
        />
      ) : (
        <FlatList
          data={recent.visits ?? []}
          keyExtractor={(visit) => visit.id}
          refreshControl={<RefreshControl refreshing={recent.refreshing} onRefresh={recent.refresh} />}
          ListHeaderComponent={
            <View className="flex-row items-center justify-between pb-2">
              <Text variant="large">{strings.home.recentVisits}</Text>
              <Button variant="ghost" size="sm" onPress={leave}>
                <Text>{strings.home.signOut}</Text>
              </Button>
            </View>
          }
          renderItem={({ item }) => (
            <VisitRow
              visit={item}
              showClient
              onPress={() => router.push({ pathname: '/clients/[id]', params: { id: item.clientId } })}
            />
          )}
          ListEmptyComponent={
            recent.failed ? (
              <Text variant="muted">{strings.home.loadFailed}</Text>
            ) : recent.visits ? (
              <Text variant="muted">{strings.home.noVisits}</Text>
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}
