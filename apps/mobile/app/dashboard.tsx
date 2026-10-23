import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { type Dashboard, getCurrentBarber, getDashboard } from '@/api';
import { strings } from '@/lib/strings';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

type Access = 'checking' | 'owner' | 'not-owner';

const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

// One number with its name, read as one phrase by a screen reader.
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className="bg-card border-border min-w-[45%] flex-1 gap-1 rounded-lg border p-4"
    >
      <Text variant="muted">{label}</Text>
      <Text variant="h3">{value}</Text>
    </View>
  );
}

// A short ranked list: each row's name, a bar against the list's largest
// count, and the count itself.
function BarList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; name: string; visits: number }[];
}) {
  const largest = Math.max(0, ...rows.map((row) => row.visits));
  return (
    <View accessibilityLabel={title} className="gap-2">
      <Text variant="large">{title}</Text>
      {rows.length === 0 && <Text variant="muted">{strings.dashboard.noVisits}</Text>}
      {rows.map((row) => (
        <View key={row.key} accessible accessibilityLabel={`${row.name}: ${row.visits}`} className="gap-1">
          <View className="flex-row justify-between gap-2">
            <Text className="flex-1" numberOfLines={1}>
              {row.name}
            </Text>
            <Text className="font-medium">{row.visits}</Text>
          </View>
          <View className="bg-muted h-2 overflow-hidden rounded-full">
            <View
              className="bg-primary h-2 rounded-full"
              style={{ width: `${largest === 0 ? 0 : (row.visits / largest) * 100}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// The owner's numbers for the shop. A barber who is not the owner never gets
// here from home, and a direct route sends them back.
export default function DashboardScreen() {
  const [access, setAccess] = useState<Access>('checking');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const barber = await getCurrentBarber();
      if (barber?.role !== 'owner') {
        setAccess('not-owner');
        return;
      }
      setAccess('owner');
      setDashboard(await getDashboard());
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function retry() {
    setFailed(false);
    void load();
  }

  if (access === 'not-owner') return <Redirect href="/home" />;

  if (failed && !dashboard) {
    return (
      <Screen className="items-center justify-center">
        <Text>{strings.dashboard.loadFailed}</Text>
        <Button variant="outline" onPress={retry}>
          <Text>{strings.dashboard.retry}</Text>
        </Button>
      </Screen>
    );
  }

  return (
    <Screen className="pb-0">
      <Text variant="h3">{strings.dashboard.title}</Text>
      {dashboard && (
        <ScrollView contentContainerClassName="gap-6 pb-6">
          <View className="flex-row flex-wrap gap-3">
            <Tile label={strings.dashboard.visitsThisWeek} value={String(dashboard.visitsThisWeek)} />
            <Tile label={strings.dashboard.visitsThisMonth} value={String(dashboard.visitsThisMonth)} />
            <Tile
              label={strings.dashboard.returningClients}
              value={percent.format(dashboard.returningClientShare)}
            />
            <Tile label={strings.dashboard.totalClients} value={String(dashboard.totalClients)} />
          </View>
          <BarList
            title={strings.dashboard.visitsPerBarber}
            rows={dashboard.visitsPerBarber.map((row) => ({
              key: row.barberId,
              name: row.displayName,
              visits: row.visits,
            }))}
          />
          <BarList
            title={strings.dashboard.topHairStyles}
            rows={dashboard.topHairStyles.map((row) => ({ key: row.styleId, name: row.name, visits: row.visits }))}
          />
          <BarList
            title={strings.dashboard.topBeardStyles}
            rows={dashboard.topBeardStyles.map((row) => ({ key: row.styleId, name: row.name, visits: row.visits }))}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
