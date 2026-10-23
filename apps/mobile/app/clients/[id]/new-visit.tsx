import { FormError } from '@/components/form-error';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { startVisit } from '@/api';
import { strings } from '@/lib/strings';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

type Consent = 'not-given' | 'saving' | 'saved';

// Consent comes first: ticking the box opens the visit, and only then can the
// camera open. Once saved, consent stays given.
export default function NewVisitScreen() {
  const router = useRouter();
  const { id: clientId } = useLocalSearchParams<{ id: string }>();
  // One id per screen, so a retry after a failure starts the same visit.
  const [visitId] = useState(randomUUID);
  const [consent, setConsent] = useState<Consent>('not-given');
  const [failed, setFailed] = useState(false);

  async function agree(checked: boolean) {
    if (!checked || consent !== 'not-given') return;
    setConsent('saving');
    setFailed(false);
    try {
      await startVisit({ id: visitId, clientId, consentGiven: true });
      setConsent('saved');
    } catch {
      setConsent('not-given');
      setFailed(true);
    }
  }

  return (
    <Screen>
      <Text variant="h3">{strings.newVisit.title}</Text>
      <Text>{strings.newVisit.privacy}</Text>
      <View className="flex-row items-center gap-3">
        <Checkbox
          accessibilityLabel={strings.newVisit.consent}
          checked={consent !== 'not-given'}
          onCheckedChange={agree}
          disabled={consent !== 'not-given'}
        />
        <Text onPress={() => agree(true)} className="flex-1">
          {strings.newVisit.consent}
        </Text>
      </View>
      <FormError message={failed ? strings.newVisit.failed : null} />
      <Button
        disabled={consent !== 'saved'}
        onPress={() => router.replace({ pathname: '/visits/[id]/photos', params: { id: visitId } })}
      >
        <Text>{strings.newVisit.takePhotos}</Text>
      </Button>
    </Screen>
  );
}
