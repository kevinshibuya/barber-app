import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

// A labelled text input; the label is also the input's accessible name.
export function Field({ label, ...props }: { label: string } & ComponentProps<typeof Input>) {
  return (
    <View className="gap-1.5">
      <Text variant="small">{label}</Text>
      <Input accessibilityLabel={label} {...props} />
    </View>
  );
}
