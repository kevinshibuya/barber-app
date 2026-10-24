import { Text } from '@/components/ui/text';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import type { PhotoSlot } from '@barber/shared';
import { type ReactNode, useEffect, useRef } from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import PagerView from 'react-native-pager-view';

// The visit's angles as a horizontal pager, one page per angle in the order
// given, shared by the picker and full screen so both swipe alike. `angle` is
// the caller's current angle: a swipe reports the page it settles on through
// `onAngle`, and an angle set from outside, as by a pill, pages to it.
export function AnglePager({
  angles,
  angle,
  onAngle,
  renderPage,
  style,
}: {
  angles: readonly PhotoSlot[];
  angle: PhotoSlot;
  onAngle: (angle: PhotoSlot) => void;
  renderPage: (angle: PhotoSlot, current: boolean) => ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const pager = useRef<PagerView>(null);
  const index = Math.max(angles.indexOf(angle), 0);
  // The page the pager is on, so only an angle set from outside pages it.
  const position = useRef(index);

  useEffect(() => {
    if (position.current === index) return;
    position.current = index;
    pager.current?.setPage(index);
  }, [index]);

  return (
    <PagerView
      ref={pager}
      testID="angle-pager"
      initialPage={index}
      style={style}
      onPageSelected={(event) => {
        position.current = event.nativeEvent.position;
        const selected = angles[event.nativeEvent.position];
        if (selected && selected !== angle) onAngle(selected);
      }}
    >
      {angles.map((pageAngle) => (
        <View key={pageAngle} testID={`angle-page-${pageAngle}`} collapsable={false} className="flex-1">
          {renderPage(pageAngle, pageAngle === angle)}
        </View>
      ))}
    </PagerView>
  );
}

// One pill per angle, named on screen, the current one filled; a tap pages to
// its angle. Drawn over a photo, so it reads white on dark.
export function AnglePills({
  angles,
  angle,
  onAngle,
  className,
}: {
  angles: readonly PhotoSlot[];
  angle: PhotoSlot;
  onAngle: (angle: PhotoSlot) => void;
  className?: string;
}) {
  return (
    <View role="tablist" accessibilityLabel={strings.picker.a11y.angles} className={cn('flex-row gap-2', className)}>
      {angles.map((pillAngle) => {
        const active = pillAngle === angle;
        return (
          <Pressable
            key={pillAngle}
            role="tab"
            accessibilityLabel={strings.picker.angle[pillAngle]}
            accessibilityState={{ selected: active }}
            hitSlop={8}
            onPress={() => onAngle(pillAngle)}
            className={cn('rounded-full px-3 py-1', active ? 'bg-white' : 'bg-black/40')}
          >
            <Text className={cn('text-sm', active ? 'font-semibold text-black' : 'text-white')}>
              {strings.picker.angle[pillAngle]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
