import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { getCurrentBarber } from '@/api';
import { strings } from '@/lib/strings';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

type Session = 'checking' | 'signed-in' | 'signed-out' | 'failed';

// The entry: a stored session goes straight to home, anything else to login.
export default function EntryScreen() {
  const [session, setSession] = useState<Session>('checking');

  const check = useCallback(
    () =>
      getCurrentBarber().then(
        (barber) => setSession(barber ? 'signed-in' : 'signed-out'),
        () => setSession('failed'),
      ),
    [],
  );

  useEffect(() => {
    void check();
  }, [check]);

  function retry() {
    setSession('checking');
    void check();
  }

  if (session === 'signed-in') return <Redirect href="/home" />;
  if (session === 'signed-out') return <Redirect href="/login" />;

  return (
    <View className="bg-background flex-1 items-center justify-center gap-2 p-6">
      <Text variant="h1">{strings.root.title}</Text>
      <Text variant="muted" className="text-center">
        {strings.root.tagline}
      </Text>
      {session === 'failed' && (
        <View className="items-center gap-3 pt-4">
          <Text className="text-center">{strings.root.loadFailed}</Text>
          <Button variant="outline" onPress={retry}>
            <Text>{strings.root.retry}</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
