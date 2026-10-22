import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { createClient } from '@/api';
import { strings } from '@/lib/strings';
import { useRouter } from 'expo-router';
import { useState } from 'react';

export default function NewClientScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return setError(strings.newClient.nameRequired);
    setBusy(true);
    setError(null);
    try {
      const client = await createClient({ name: name.trim(), phone: phone.trim() || null });
      router.replace({ pathname: '/clients/[id]', params: { id: client.id } });
      return;
    } catch {
      setError(strings.newClient.failed);
    }
    setBusy(false);
  }

  return (
    <Screen>
      <Text variant="h3">{strings.newClient.title}</Text>
      <Field
        label={strings.newClient.name}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
      />
      <Field
        label={strings.newClient.phone}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        onSubmitEditing={submit}
      />
      <FormError message={error} />
      <Button onPress={submit} disabled={busy}>
        <Text>{strings.newClient.submit}</Text>
      </Button>
    </Screen>
  );
}
