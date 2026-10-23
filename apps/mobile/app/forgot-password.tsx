import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { requestPasswordReset } from '@/api';
import { strings } from '@/lib/strings';
import { Link } from 'expo-router';
import { useState } from 'react';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch {
      setError(strings.forgotPassword.failed);
    }
    setBusy(false);
  }

  return (
    <Screen className="justify-center">
      <Text variant="h3">{strings.forgotPassword.title}</Text>
      {sent ? (
        <Text>{strings.forgotPassword.sent}</Text>
      ) : (
        <>
          <Text variant="muted">{strings.forgotPassword.message}</Text>
          <Field
            label={strings.forgotPassword.email}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            onSubmitEditing={submit}
          />
          <FormError message={error} />
          <Button onPress={submit} disabled={busy || !email.trim()}>
            <Text>{strings.forgotPassword.submit}</Text>
          </Button>
        </>
      )}
      <Link href="/login" replace asChild>
        <Button variant="link">
          <Text>{strings.forgotPassword.backToLogin}</Text>
        </Button>
      </Link>
    </Screen>
  );
}
