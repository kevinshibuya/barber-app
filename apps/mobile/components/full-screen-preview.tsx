import { AnglePager, AnglePills } from '@/components/angle-pager';
import { DismissableModal } from '@/components/dismissable-modal';
import { CAPTION_SCRIM } from '@/components/picker-tile';
import { LookStatus } from '@/components/look-status';
import { Image } from '@/components/ui/image';
import type { LookPreview } from '@/lib/picker';
import type { PhotoSlot } from '@barber/shared';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The selected look full screen (graft C): one page per photographed angle,
// on the picker's pager and angle pills, with the controls laid on the photo,
// in the dismissable modal: its arrow or a swipe down closes it, a sideways
// swipe pages. It opens on the picker's angle and pages it along. `choose`
// renders the pill for the page on screen.
export function FullScreenPreview({
  looks,
  angle,
  onAngle,
  onClose,
  onRetry,
  choose,
}: {
  looks: LookPreview[];
  angle: PhotoSlot;
  onAngle: (angle: PhotoSlot) => void;
  onClose: () => void;
  onRetry: (look: LookPreview) => void;
  choose: (look: LookPreview) => ReactNode;
}) {
  const angles = looks.map((look) => look.slot);
  const current = looks.find((look) => look.slot === angle) ?? looks[0];
  // From the hook, as the modal's header: a native SafeAreaView inside a
  // Modal finds no provider and pads nothing.
  const insets = useSafeAreaInsets();

  return (
    <DismissableModal testID="full-screen-preview" onClose={onClose}>
      <View className="flex-1">
        <AnglePager
          angles={angles}
          angle={current?.slot ?? angle}
          onAngle={onAngle}
          style={{ flex: 1 }}
          renderPage={(pageAngle) => {
            const look = looks.find((entry) => entry.slot === pageAngle)!;
            return (
              <View className="flex-1 items-center justify-center">
                {look.imageUrl && (
                  <Image
                    testID={`angle-image-${look.slot}`}
                    source={{ uri: look.imageUrl }}
                    contentFit="cover"
                    className="absolute inset-0"
                  />
                )}
                <LookStatus look={look} onRetry={onRetry} />
              </View>
            );
          }}
        />
        <View
          style={[CAPTION_SCRIM, { paddingBottom: insets.bottom + 12 }]}
          className="absolute inset-x-0 bottom-0 flex-row items-end justify-between gap-3 px-3 pt-10"
        >
          <AnglePills angles={angles} angle={current?.slot ?? angle} onAngle={onAngle} className="flex-1 flex-wrap" />
          {current && choose(current)}
        </View>
      </View>
    </DismissableModal>
  );
}
