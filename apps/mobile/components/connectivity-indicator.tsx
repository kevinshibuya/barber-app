import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { type Connectivity, subscribeToConnectivity } from '@/api';
import { strings } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { CloudUpload, WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

function label({ offline, queued }: Connectivity): string | null {
  if (offline) return queued > 0 ? strings.connectivity.waiting(queued) : strings.connectivity.offline;
  return queued > 0 ? strings.connectivity.sending(queued) : null;
}

// One muted line, an icon and its text, while the connection is down or
// uploads are still owed; nothing otherwise. `className` places it, and
// `inverted` sets it in white over a photo.
export function ConnectivityIndicator({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  const [connectivity, setConnectivity] = useState<Connectivity>({ offline: false, queued: 0 });
  useEffect(() => subscribeToConnectivity(setConnectivity), []);

  const text = label(connectivity);
  if (!text) return null;
  const tone = inverted ? 'text-white' : 'text-muted-foreground';
  return (
    <View role="status" className={cn('flex-row items-center gap-1.5', className)}>
      <Icon as={connectivity.offline ? WifiOff : CloudUpload} size={14} className={tone} />
      <Text className={cn('text-xs', tone)}>{text}</Text>
    </View>
  );
}
