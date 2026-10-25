import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';

// expo-image with NativeWind's `className`, registered once here as the icon
// component registers lucide's. The visit flow's images import it from here.
cssInterop(Image, { className: 'style' });

export { Image };
