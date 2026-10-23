import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { SlotState } from '@/api/slots';
import type { PhotoSource } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import type { PhotoSlot } from '@barber/shared';
import { ActivityIndicator, Image, View } from 'react-native';

// One slot, laid out like a visit row: the shot's thumbnail, the slot's name
// and upload state, and its camera and gallery buttons. A filled slot is
// retaken with the same buttons; a failed one also offers a retry.
export function PhotoSlotRow({
  slot,
  state,
  required,
  onShoot,
  onRetry,
}: {
  slot: PhotoSlot;
  state: SlotState;
  required: boolean;
  onShoot: (source: PhotoSource) => void;
  onRetry: () => void;
}) {
  const busy = state.status === 'uploading';
  return (
    <View accessibilityLabel={strings.photos.slots[slot]} className="flex-row items-center gap-3 rounded-md py-2">
      {state.image ? (
        <Image source={{ uri: state.image.uri }} className="bg-muted size-16 rounded-md" />
      ) : (
        <View className="bg-muted size-16 rounded-md" />
      )}
      <View className="flex-1 gap-0.5">
        <Text className="font-medium">{strings.photos.slots[slot]}</Text>
        <Text variant="muted">{required ? strings.photos.required : strings.photos.optional}</Text>
        <View className="flex-row items-center gap-1">
          {busy && <ActivityIndicator size="small" />}
          <Text className={state.status === 'failed' ? 'text-destructive text-sm' : 'text-sm'}>
            {strings.photos.status[state.status]}
          </Text>
        </View>
      </View>
      <View className="gap-1">
        {state.status === 'failed' && (
          <Button size="sm" onPress={onRetry}>
            <Text>{strings.photos.retry}</Text>
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onPress={() => onShoot('camera')}>
          <Text>{strings.photos.camera}</Text>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onPress={() => onShoot('gallery')}>
          <Text>{strings.photos.gallery}</Text>
        </Button>
      </View>
    </View>
  );
}
