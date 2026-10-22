import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';

// The after photo, close and share replace this in the finish ticket.
export default function FinishScreen() {
  return (
    <Screen className="items-center justify-center">
      <Text variant="h3">{strings.finish.title}</Text>
      <Text variant="muted">{strings.finish.comingSoon}</Text>
    </Screen>
  );
}
