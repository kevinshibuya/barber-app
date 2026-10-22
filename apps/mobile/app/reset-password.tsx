import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { openPasswordResetLink, setNewPassword } from '@/api';
import { strings } from '@/lib/strings';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

// Supabase's own minimum; the server has the last word.
const MIN_PASSWORD_LENGTH = 6;

type LinkState = 'opening' | 'open' | 'expired';

// Exchanges the link's code once per code; no code is an expired link.
function useResetLink(code: string | undefined): LinkState {
  const [opened, setOpened] = useState<{ code: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!code) return;
    let current = true;
    openPasswordResetLink(code).then(
      (ok) => current && setOpened({ code, ok }),
      () => current && setOpened({ code, ok: false }),
    );
    return () => {
      current = false;
    };
  }, [code]);

  if (!code) return 'expired';
  if (opened?.code !== code) return 'opening';
  return opened.ok ? 'open' : 'expired';
}

// Opened by the password reset email's link, `barber://reset-password?code=…`.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const link = useResetLink(code);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < MIN_PASSWORD_LENGTH) return setError(strings.resetPassword.tooShort);
    if (password !== confirm) return setError(strings.resetPassword.mismatch);
    setBusy(true);
    setError(null);
    try {
      const result = await setNewPassword(password);
      if (result.ok) {
        router.replace('/home');
        return;
      }
      setError(result.reason === 'weak-password' ? strings.resetPassword.weak : strings.resetPassword.same);
    } catch {
      setError(strings.resetPassword.failed);
    }
    setBusy(false);
  }

  return (
    <Screen className="justify-center">
      <Text variant="h3">{strings.resetPassword.title}</Text>
      {link === 'opening' && <Text variant="muted">{strings.resetPassword.opening}</Text>}
      {link === 'expired' && (
        <>
          <Text>{strings.resetPassword.linkExpired}</Text>
          <Link href="/forgot-password" replace asChild>
            <Button>
              <Text>{strings.resetPassword.requestAgain}</Text>
            </Button>
          </Link>
        </>
      )}
      {link === 'open' && (
        <>
          <Field
            label={strings.resetPassword.password}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <Field
            label={strings.resetPassword.confirm}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={submit}
          />
          <FormError message={error} />
          <Button onPress={submit} disabled={busy || !password || !confirm}>
            <Text>{strings.resetPassword.submit}</Text>
          </Button>
        </>
      )}
    </Screen>
  );
}
