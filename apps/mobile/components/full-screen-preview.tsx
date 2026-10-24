import { AnglePager, AnglePills } from '@/components/angle-pager';
import { CAPTION_SCRIM } from '@/components/picker-tile';
import { LookStatus } from '@/components/look-status';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import type { LookPreview } from '@/lib/picker';
import { strings } from '@/lib/strings';
import type { PhotoSlot } from '@barber/shared';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// The selected look full screen (graft C): one page per photographed angle,
// on the picker's pager and angle pills, with the controls laid on the photo.
// It opens on the picker's angle and pages it along. `choose` renders the
// pill for the page on screen.
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

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View testID="full-screen-preview" className="flex-1 bg-black">
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
        <SafeAreaView edges={['top']} className="absolute inset-x-0 top-0 flex-row px-2">
          <Pressable role="button" accessibilityLabel={strings.picker.a11y.back} onPress={onClose} className="p-2">
            <Icon as={ArrowLeft} size={24} className="text-white" />
          </Pressable>
        </SafeAreaView>
        <SafeAreaView
          edges={['bottom']}
          style={CAPTION_SCRIM}
          className="absolute inset-x-0 bottom-0 flex-row items-end justify-between gap-3 p-3 pt-10"
        >
          <AnglePills angles={angles} angle={current?.slot ?? angle} onAngle={onAngle} className="flex-1 flex-wrap" />
          {current && choose(current)}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
