import { FormError } from '@/components/form-error';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { closeVisit, getVisitDetail, uploadAfterPhoto, type VisitDetail } from '@/api';
import { clientPageUrl } from '@/lib/client-page';
import { pickPhoto } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Share, View } from 'react-native';

// The end of a visit: the chosen look large, as the picker shows it, then the
// after photo and the actions, in the library's defaults. The look can change
// until the after photo exists. A closed visit opens read-only.
export default function FinishScreen() {
  const router = useRouter();
  const { id: visitId } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [closing, setClosing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getVisitDetail(visitId).then(
      (loaded) => current && setDetail(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [visitId, attempt]);

  if (!detail) {
    return failed ? (
      <Screen className="items-center justify-center">
        <Text>{strings.finish.loadFailed}</Text>
        <Button
          variant="outline"
          onPress={() => {
            setFailed(false);
            setAttempt((count) => count + 1);
          }}
        >
          <Text>{strings.finish.retry}</Text>
        </Button>
      </Screen>
    ) : (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  const { visit, lookImageUrl, afterPhotoUrl } = detail;
  const open = visit.status === 'open';
  const hasAfter = visit.afterPhotoPath !== null;

  function changeLook() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/visits/[id]/picker', params: { id: visitId } });
  }

  async function takeAfter() {
    setError(null);
    const result = await pickPhoto('camera');
    if (result.status === 'denied') setError(strings.finish.cameraDenied);
    if (result.status !== 'picked') return;
    setUploading(true);
    try {
      const saved = await uploadAfterPhoto(visitId, result.image);
      // The shot on the device shows at once; the signed URL is for a later open.
      setDetail((current) => current && { ...current, visit: saved, afterPhotoUrl: result.image.uri });
    } catch {
      setError(strings.finish.afterFailed);
    } finally {
      setUploading(false);
    }
  }

  // The platform share sheet, where the barber picks WhatsApp.
  async function share(shareToken: string) {
    setError(null);
    try {
      await Share.share({ message: strings.finish.shareMessage(clientPageUrl(shareToken)) });
    } catch {
      setError(strings.finish.shareFailed);
    }
  }

  async function close() {
    setClosing(true);
    setError(null);
    try {
      const closed = await closeVisit(visitId);
      setDetail((current) => current && { ...current, visit: closed });
    } catch {
      setError(strings.finish.closeFailed);
    } finally {
      setClosing(false);
    }
  }

  return (
    <Screen className="pb-0">
      <Text variant="h3">{open ? strings.finish.title : strings.finish.closed}</Text>
      <ScrollView contentContainerClassName="gap-4 pb-6">
        <View className="bg-muted aspect-[3/4] w-full overflow-hidden rounded-md">
          {lookImageUrl ? (
            <Image
              testID="look-image"
              source={{ uri: lookImageUrl }}
              accessibilityLabel={strings.finish.look}
              resizeMode="cover"
              className="absolute inset-0"
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text variant="muted">{strings.finish.noLook}</Text>
            </View>
          )}
        </View>
        {open && !hasAfter && (
          <Button variant="outline" onPress={changeLook}>
            <Text>{lookImageUrl ? strings.finish.changeLook : strings.finish.chooseLook}</Text>
          </Button>
        )}
        <Text variant="large">{strings.finish.after}</Text>
        {afterPhotoUrl ? (
          <Image
            testID="after-image"
            source={{ uri: afterPhotoUrl }}
            accessibilityLabel={strings.finish.after}
            resizeMode="cover"
            className="bg-muted aspect-[3/4] w-full rounded-md"
          />
        ) : (
          !open && <Text variant="muted">{strings.finish.noAfter}</Text>
        )}
        {open && (
          <Button variant="outline" disabled={uploading || closing} onPress={() => void takeAfter()}>
            {uploading && <ActivityIndicator size="small" />}
            <Text>
              {uploading ? strings.finish.uploadingAfter : hasAfter ? strings.finish.retakeAfter : strings.finish.takeAfter}
            </Text>
          </Button>
        )}
        <FormError message={error} />
        {open && (
          <Button disabled={closing || uploading} onPress={() => void close()}>
            <Text>{strings.finish.close}</Text>
          </Button>
        )}
        <Button
          variant={open ? 'outline' : 'default'}
          disabled={!visit.shareToken}
          onPress={() => visit.shareToken && void share(visit.shareToken)}
        >
          <Text>{strings.finish.share}</Text>
        </Button>
        {!visit.shareToken && <Text variant="muted">{strings.finish.shareExpired}</Text>}
      </ScrollView>
    </Screen>
  );
}
