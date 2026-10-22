import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';

// Consent and the photo slots replace this in the next ticket.
export default function NewVisitScreen() {
  return (
    <Screen className="items-center justify-center">
      <Text variant="h3">{strings.newVisit.title}</Text>
      <Text variant="muted">{strings.newVisit.comingSoon}</Text>
    </Screen>
  );
}
