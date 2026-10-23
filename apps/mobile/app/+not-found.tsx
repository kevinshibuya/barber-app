import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';
import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: strings.notFound.title }} />
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <Text>{strings.notFound.message}</Text>
        <Link href="/">
          <Text className="text-primary underline">{strings.notFound.goHome}</Text>
        </Link>
      </View>
    </>
  );
}
