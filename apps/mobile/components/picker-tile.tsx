import { Text } from '@/components/ui/text';
import type { Tile } from '@/lib/picker';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

// The caption's scrim, darkest at the tile's bottom edge (graft B).
export const CAPTION_SCRIM = { backgroundImage: 'linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent)' };

const STATUS_LINE = {
  generating: strings.picker.tile.generating,
  failed: strings.picker.tile.failed,
  refused: strings.picker.tile.refused,
} as const;

// One style of a picker tab: a portrait photo tile (graft A) with the style's
// name and status line over a scrim (graft B), outlined when selected (spine).
// A refused tile is inert.
export function PickerTile({
  tile,
  selected,
  width,
  onPress,
}: {
  tile: Tile;
  selected: boolean;
  width: number;
  onPress: () => void;
}) {
  const refused = tile.status === 'refused';
  const statusLine = tile.status === 'keep' || tile.status === 'done' ? null : STATUS_LINE[tile.status];
  const name = tile.status === 'keep' ? strings.picker.tile.keep : tile.style.name;
  return (
    <Pressable
      role="button"
      accessibilityLabel={name}
      accessibilityState={{ selected, disabled: refused }}
      disabled={refused}
      onPress={onPress}
      // An explicit height: Android's release build drops aspectRatio beside a className.
      style={{ width, height: width * 1.5 }}
      className={cn('bg-muted overflow-hidden rounded-xl border-[3px]', selected ? 'border-primary' : 'border-transparent')}
    >
      {tile.imageUrl && (
        <Image testID="tile-image" source={{ uri: tile.imageUrl }} resizeMode="cover" className="absolute inset-0" />
      )}
      <View style={CAPTION_SCRIM} className="absolute inset-x-0 bottom-0 gap-0.5 px-2 pb-2 pt-6">
        <Text numberOfLines={2} className="text-sm font-medium text-white">
          {name}
        </Text>
        {statusLine && (
          <View className="flex-row items-center gap-1">
            {tile.status === 'generating' && <ActivityIndicator size="small" color="white" />}
            <Text numberOfLines={2} className="text-xs text-white/80">
              {statusLine}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
