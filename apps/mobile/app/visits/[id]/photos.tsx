import { ConnectivityIndicator } from '@/components/connectivity-indicator';
import { FormError } from '@/components/form-error';
import { PhotoSlotRow } from '@/components/photo-slot-row';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { type LocalImage, listVisitPhotos, subscribeToUploads, uploadPhoto } from '@/api';
import { canContinue, emptySlots, photoSlotsReducer, REQUIRED_SLOT } from '@/api/slots';
import { type PhotoSource, pickPhoto } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import { PHOTO_SLOTS, type PhotoSlot } from '@barber/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useReducer, useState } from 'react';
import { ScrollView, View } from 'react-native';

// The four slots of a visit. A slot uploads the moment it is filled, through
// the upload queue, which retries on bad wifi and after the app closes; a
// queued slot waits for the connection rather than failing. A resumed visit
// shows the photos it already has.
export default function PhotosScreen() {
  const router = useRouter();
  const { id: visitId } = useLocalSearchParams<{ id: string }>();
  const [slots, dispatch] = useReducer(photoSlotsReducer, undefined, emptySlots);
  const [cameraDenied, setCameraDenied] = useState(false);

  useEffect(() => {
    let current = true;
    // A visit whose photos cannot be read starts with empty slots.
    listVisitPhotos(visitId).then(
      (photos) => current && dispatch({ type: 'loaded', photos }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [visitId]);

  useEffect(() => subscribeToUploads(visitId, (uploads) => dispatch({ type: 'queue', uploads })), [visitId]);

  async function upload(slot: PhotoSlot, image: LocalImage) {
    dispatch({ type: 'started', slot, image });
    try {
      await uploadPhoto({ visitId, slot, ...image });
    } catch {
      dispatch({ type: 'failed', slot });
    }
  }

  async function shoot(slot: PhotoSlot, source: PhotoSource) {
    const result = await pickPhoto(source);
    setCameraDenied(result.status === 'denied');
    if (result.status === 'picked') await upload(slot, result.image);
  }

  function retry(slot: PhotoSlot) {
    const image = slots[slot].image;
    if (image) void upload(slot, image);
  }

  return (
    <Screen className="pb-0">
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="h3">{strings.photos.title}</Text>
        <ConnectivityIndicator />
      </View>
      <FormError message={cameraDenied ? strings.photos.cameraDenied : null} />
      <ScrollView contentContainerClassName="gap-2 pb-4">
        {PHOTO_SLOTS.map((slot) => (
          <PhotoSlotRow
            key={slot}
            slot={slot}
            state={slots[slot]}
            required={slot === REQUIRED_SLOT}
            onShoot={(source) => void shoot(slot, source)}
            onRetry={() => retry(slot)}
          />
        ))}
        <Button
          disabled={!canContinue(slots)}
          onPress={() => router.push({ pathname: '/visits/[id]/picker', params: { id: visitId } })}
        >
          <Text>{strings.photos.continue}</Text>
        </Button>
      </ScrollView>
    </Screen>
  );
}
