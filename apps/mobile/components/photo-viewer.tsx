import { DismissableModal } from '@/components/dismissable-modal';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Text } from '@/components/ui/text';
import type { LocalImage } from '@/api';
import type { PhotoSource } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import type { PhotoSlot } from '@barber/shared';
import { useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fitContainer, ResumableZoom, type ResumableZoomRefType } from 'react-native-zoom-toolkit';

// One angle's photo full screen, to judge the shot: pinch or double-tap to
// zoom, pan once zoomed, and the row's camera and gallery under the photo to
// retake it. A zoomed photo keeps every drag for panning; at rest a swipe
// down closes the viewer.
export function PhotoViewer({
  slot,
  image,
  busy,
  cameraDenied,
  onShoot,
  onClose,
}: {
  slot: PhotoSlot;
  image: LocalImage;
  busy: boolean;
  cameraDenied: boolean;
  onShoot: (source: PhotoSource) => void;
  onClose: () => void;
}) {
  const zoom = useRef<ResumableZoomRefType>(null);
  const [zoomed, setZoomed] = useState(false);
  const window = useWindowDimensions();
  const [area, setArea] = useState({ width: window.width, height: window.height });
  const insets = useSafeAreaInsets();
  const size = fitContainer(image.width / image.height, area);

  return (
    <DismissableModal
      testID="photo-viewer"
      title={strings.photos.slots[slot]}
      onClose={onClose}
      swipeEnabled={!zoomed}
    >
      <View className="flex-1">
        <View
          className="flex-1"
          onLayout={(event) => setArea({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        >
          <ResumableZoom
            ref={zoom}
            panEnabled={zoomed}
            onGestureEnd={() => setZoomed((zoom.current?.getState().scale ?? 1) > 1)}
          >
            <Image testID="photo-viewer-image" source={{ uri: image.uri }} contentFit="contain" style={size} />
          </ResumableZoom>
        </View>
        <View style={{ paddingBottom: insets.bottom + 12 }} className="gap-2 px-4 pt-3">
          <FormError message={cameraDenied ? strings.photos.cameraDenied : null} />
          <View className="flex-row gap-3">
            <Button variant="secondary" disabled={busy} onPress={() => onShoot('camera')} className="flex-1">
              <Text>{strings.photos.camera}</Text>
            </Button>
            <Button variant="secondary" disabled={busy} onPress={() => onShoot('gallery')} className="flex-1">
              <Text>{strings.photos.gallery}</Text>
            </Button>
          </View>
        </View>
      </View>
    </DismissableModal>
  );
}
