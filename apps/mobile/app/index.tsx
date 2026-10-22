import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';
import { View } from 'react-native';

export default function RootScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-6">
      <Text variant="h1">{strings.root.title}</Text>
      <Text variant="muted" className="text-center">
        {strings.root.tagline}
      </Text>
    </View>
  );
}
