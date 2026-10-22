import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';

// The hair and beard tabs replace this in the picker ticket.
export default function PickerScreen() {
  return (
    <Screen className="items-center justify-center">
      <Text variant="h3">{strings.picker.title}</Text>
      <Text variant="muted">{strings.picker.comingSoon}</Text>
    </Screen>
  );
}
