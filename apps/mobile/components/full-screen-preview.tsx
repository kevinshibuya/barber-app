import { CAPTION_SCRIM } from '@/components/picker-tile';
import { LookStatus } from '@/components/look-status';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { LookPreview } from '@/lib/picker';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react-native';
import { type ReactNode, useRef } from 'react';
import { Image, Modal, Pressable, ScrollView, type ScrollViewInstance, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// The selected look full screen (graft C): one page per photographed angle,
// in slot order, swiped or picked from the angle row, with the controls laid
// on the photo. `choose` renders the pill for the page on screen.
export function FullScreenPreview({
  looks,
  page,
  onPage,
  onClose,
  onRetry,
  choose,
}: {
  looks: LookPreview[];
  page: number;
  onPage: (page: number) => void;
  onClose: () => void;
  onRetry: (look: LookPreview) => void;
  choose: (look: LookPreview) => ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const pager = useRef<ScrollViewInstance>(null);
  const current = looks[page] ?? looks[0];

  function go(index: number) {
    pager.current?.scrollTo({ x: index * width, animated: true });
    onPage(index);
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View testID="full-screen-preview" className="flex-1 bg-black">
        <ScrollView
          ref={pager}
          testID="angle-pager"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => onPage(Math.round(event.nativeEvent.contentOffset.x / width))}
        >
          {looks.map((look) => (
            <View key={look.slot} style={{ width, height }} className="items-center justify-center">
              {look.imageUrl && (
                <Image
                  testID={`angle-image-${look.slot}`}
                  source={{ uri: look.imageUrl }}
                  resizeMode="cover"
                  className="absolute inset-0"
                />
              )}
              <LookStatus look={look} onRetry={onRetry} />
            </View>
          ))}
        </ScrollView>
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
          <View role="tablist" className="flex-1 flex-row gap-5">
            {looks.map((look, index) => {
              const active = look === current;
              return (
                <Pressable
                  key={look.slot}
                  role="tab"
                  accessibilityLabel={strings.picker.angle[look.slot]}
                  accessibilityState={{ selected: active }}
                  onPress={() => go(index)}
                  className="items-center gap-1.5"
                >
                  <Text className={cn('text-base text-white', active ? 'font-bold' : 'opacity-70')}>
                    {strings.picker.angle[look.slot]}
                  </Text>
                  <View className={cn('h-0.5 w-6 rounded-full', active ? 'bg-white' : 'bg-transparent')} />
                </Pressable>
              );
            })}
          </View>
          {current && choose(current)}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
