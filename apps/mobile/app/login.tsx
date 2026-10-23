import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { signIn } from '@/api';
import { strings } from '@/lib/strings';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email, password);
      if (result.ok) {
        router.replace('/home');
        return;
      }
      setError(result.reason === 'wrong-credentials' ? strings.login.wrongCredentials : strings.login.notABarber);
    } catch {
      setError(strings.login.failed);
    }
    setBusy(false);
  }

  return (
    <Screen className="justify-center">
      <View className="items-center gap-2 pb-4">
        <Text variant="h1">{strings.root.title}</Text>
        <Text variant="muted" className="text-center">
          {strings.root.tagline}
        </Text>
      </View>
      <Field
        label={strings.login.email}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label={strings.login.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      <FormError message={error} />
      <Button onPress={submit} disabled={busy || !email.trim() || !password}>
        <Text>{strings.login.submit}</Text>
      </Button>
      <Link href="/forgot-password" asChild>
        <Button variant="link">
          <Text>{strings.login.forgotPassword}</Text>
        </Button>
      </Link>
    </Screen>
  );
}
