import type { LocalImage } from '@/api';
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'camera' | 'gallery';

export type PickResult = { status: 'picked'; image: LocalImage } | { status: 'cancelled' } | { status: 'denied' };

// One photo from the camera or the gallery, at full size: the `api` module
// downscales it before upload.
export async function pickPhoto(source: PhotoSource): Promise<PickResult> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return { status: 'cancelled' };
  return { status: 'picked', image: { uri: asset.uri, width: asset.width, height: asset.height } };
}
