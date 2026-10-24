import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

// Apple's minimum touch target, in points.
export const BACK_TARGET = 44;

// A drag that ends this far down, or flung this fast, closes the modal.
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 1000;

// Anything shown full screen: a header inside the top safe area with a back
// arrow and an optional title, laid over the content, and a downward swipe on
// the content that closes it. A sideways drag fails the swipe and stays the
// content's, so a pager inside keeps its pages. `swipeEnabled` lets content
// that pans on its own, a zoomed photo, keep vertical drags too.
export function DismissableModal({
  title,
  onClose,
  swipeEnabled = true,
  testID,
  children,
}: {
  title?: string;
  onClose: () => void;
  swipeEnabled?: boolean;
  testID?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(0);

  const swipe = usePanGesture({
    testID: 'modal-dismiss',
    enabled: swipeEnabled,
    maxPointers: 1,
    activeOffsetY: 20,
    failOffsetX: [-20, 20],
    onUpdate: (event) => {
      'worklet';
      offset.value = Math.max(0, event.translationY);
    },
    onDeactivate: (event) => {
      'worklet';
      if (!event.canceled && (event.translationY > CLOSE_DISTANCE || event.velocityY > CLOSE_VELOCITY)) {
        scheduleOnRN(onClose);
      } else {
        offset.value = withTiming(0);
      }
    },
  });

  const follow = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      {/* Android delivers no gestures inside a modal without its own root. */}
      <GestureHandlerRootView testID={testID} style={{ flex: 1, backgroundColor: 'black' }}>
        <GestureDetector gesture={swipe}>
          <Animated.View style={[{ flex: 1 }, follow]}>
            {children}
          </Animated.View>
        </GestureDetector>
        <View
          testID="modal-header"
          style={{ paddingTop: insets.top }}
          className="absolute inset-x-0 top-0 flex-row items-center gap-1 px-2"
        >
          <Pressable
            role="button"
            accessibilityLabel={strings.modal.back}
            onPress={onClose}
            style={{ width: BACK_TARGET, height: BACK_TARGET }}
            className="items-center justify-center"
          >
            <Icon as={ArrowLeft} size={24} className="text-white" />
          </Pressable>
          {title && <Text className="text-lg font-semibold text-white">{title}</Text>}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
