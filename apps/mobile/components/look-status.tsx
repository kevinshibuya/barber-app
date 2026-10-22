import { CAPTION_SCRIM } from '@/components/picker-tile';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { LookPreview } from '@/lib/picker';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { ActivityIndicator, Pressable, View } from 'react-native';

function statusText(look: LookPreview): string | null {
  const front = look.slot === 'front';
  switch (look.status) {
    case 'done':
      return null;
    case 'generating':
      return front ? strings.picker.tile.generating : strings.picker.angle.generating;
    case 'combining':
      return front ? strings.picker.preview.combining : strings.picker.angle.generating;
    case 'failed':
      return strings.picker.tile.failed;
    case 'refused':
      return look.combination && front ? strings.picker.preview.comboRefused : strings.picker.tile.refused;
  }
}

// What a look that is not done is waiting on, over the graft B scrim: the
// library indicator while it renders, a retry tap once it failed, and a plain
// line once it was refused. Nothing once it is done.
export function LookStatus({
  look,
  onRetry,
  className,
}: {
  look: LookPreview;
  onRetry: (look: LookPreview) => void;
  className?: string;
}) {
  const text = statusText(look);
  if (!text) return null;
  const line = (
    <View className="flex-row items-center gap-2 p-2">
      {(look.status === 'generating' || look.status === 'combining') && (
        <ActivityIndicator size="small" color="white" />
      )}
      <Text className="text-sm text-white">{text}</Text>
    </View>
  );
  return look.status === 'failed' ? (
    <Pressable role="button" accessibilityLabel={text} onPress={() => onRetry(look)} style={CAPTION_SCRIM} className={cn('rounded-md', className)}>
      {line}
    </Pressable>
  ) : (
    <View style={CAPTION_SCRIM} className={cn('rounded-md', className)}>
      {line}
    </View>
  );
}

// The spine's floating pill: chooses the look once it is done, and reads as
// chosen while the pair on screen is the visit's look.
export function ChoosePill({
  look,
  chosen,
  saving,
  onChoose,
}: {
  look: LookPreview;
  chosen: boolean;
  saving: boolean;
  onChoose: (look: LookPreview) => void;
}) {
  return (
    <Button
      className="rounded-full px-6"
      disabled={look.status !== 'done' || chosen || saving}
      onPress={() => onChoose(look)}
    >
      <Text className="font-bold">{chosen ? strings.picker.chosen : strings.picker.choose}</Text>
    </Button>
  );
}
