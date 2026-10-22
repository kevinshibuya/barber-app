import { Text } from '@/components/ui/text';
import type { VisitSummary } from '@/api';
import { formatVisitDate, strings } from '@/lib/strings';
import { Image, Pressable, View } from 'react-native';

function Thumbnail({ uri, label }: { uri: string | null; label: string }) {
  if (!uri) return <View className="bg-muted size-14 rounded-md" />;
  return <Image source={{ uri }} accessibilityLabel={label} className="bg-muted size-14 rounded-md" />;
}

// One visit in a list: the chosen look's thumbnail, the after photo's, and
// who and when. Home titles it with the client; the client screen, with the date.
export function VisitRow({
  visit,
  showClient,
  onPress,
}: {
  visit: VisitSummary;
  showClient: boolean;
  onPress?: () => void;
}) {
  const date = formatVisitDate(visit.createdAt);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={showClient ? `${visit.clientName}, ${date}` : date}
      className="active:bg-accent flex-row items-center gap-3 rounded-md py-2"
    >
      <Thumbnail uri={visit.lookThumbnailUrl} label={strings.visit.look} />
      <Thumbnail uri={visit.afterPhotoUrl} label={strings.visit.after} />
      <View className="flex-1 gap-0.5">
        <Text className="font-medium">{showClient ? visit.clientName : date}</Text>
        <Text variant="muted">{strings.visit.by(visit.barberName)}</Text>
        {showClient && <Text variant="muted">{date}</Text>}
        {visit.status === 'open' && <Text className="text-primary text-sm">{strings.visit.open}</Text>}
      </View>
    </Pressable>
  );
}
