import { act, fireEvent, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { VisitPreview } from '@/api';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { imageUri } from './support/image';
import { CATALOG, pairPreview, previewOf } from './support/picker';

// The scripted subscription: the test emits the visit's previews.
let emit: (previews: VisitPreview[]) => Promise<void> = async () => undefined;

beforeEach(() => {
  emit = async () => undefined;
  jest.mocked(api.getVisit).mockResolvedValue(openVisit());
  jest.mocked(api.getClient).mockResolvedValue(client());
  jest.mocked(api.listStyles).mockResolvedValue(CATALOG);
  jest.mocked(api.listVisitPhotos).mockResolvedValue([uploadedPhoto()]);
  jest.mocked(api.subscribeToPreviews).mockImplementation((_visitId, onChange) => {
    emit = async (previews) => {
      await act(async () => onChange(previews));
    };
    return jest.fn();
  });
  jest.mocked(api.requestPreview).mockImplementation(async ({ hairStyleId, beardStyleId, slot }) =>
    pairPreview(hairStyleId.replace('hair-', ''), beardStyleId.replace('beard-', ''), 'pending', { slot }),
  );
});

async function openPicker() {
  await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
  await screen.findByRole('tab', { name: strings.picker.tab.hair });
}

async function pick(dimension: 'hair' | 'beard', name: string) {
  await fireEvent.press(screen.getByRole('tab', { name: strings.picker.tab[dimension] }));
  await fireEvent.press(screen.getByRole('button', { name }));
}

function lookImage() {
  return screen.getByTestId('look-image');
}

// Every URL the picker has fetched into the image cache, in order.
function prefetched() {
  return jest.mocked(Image.prefetch).mock.calls.map(([urls]) => urls);
}

describe('prefetching finished previews', () => {
  it('fetches the full-size image of each done preview once, never a thumbnail', async () => {
    await openPicker();

    await emit([previewOf('low-fade', 'done'), previewOf('buzz-cut', 'running')]);

    expect(prefetched()).toEqual(['https://previews.test/pv-low-fade.jpg']);

    await emit([previewOf('low-fade', 'done'), previewOf('buzz-cut', 'done')]);

    expect(prefetched()).toEqual(['https://previews.test/pv-low-fade.jpg', 'https://previews.test/pv-buzz-cut.jpg']);
    expect(prefetched().flat().some((url) => url.includes('.thumb.'))).toBe(false);
  });

  it('does not fetch a URL again while its fetch is in flight', async () => {
    jest.mocked(Image.prefetch).mockReturnValue(new Promise(() => undefined));
    await openPicker();

    await emit([previewOf('low-fade', 'done')]);
    await emit([previewOf('low-fade', 'done'), previewOf('quiff', 'pending')]);

    expect(prefetched()).toEqual(['https://previews.test/pv-low-fade.jpg']);
  });

  it('fetches again on the next emission a URL whose fetch was rejected or failed', async () => {
    jest
      .mocked(Image.prefetch)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    await openPicker();

    await emit([previewOf('low-fade', 'done')]);
    await emit([previewOf('low-fade', 'done')]);
    await emit([previewOf('low-fade', 'done')]);
    await emit([previewOf('low-fade', 'done')]);

    expect(prefetched()).toEqual([
      'https://previews.test/pv-low-fade.jpg',
      'https://previews.test/pv-low-fade.jpg',
      'https://previews.test/pv-low-fade.jpg',
    ]);
  });

  it('fetches a renewed signed URL of a preview already fetched', async () => {
    await openPicker();

    await emit([{ ...previewOf('low-fade', 'done'), imageUrl: 'https://previews.test/pv-low-fade.jpg?token=1' }]);
    await emit([{ ...previewOf('low-fade', 'done'), imageUrl: 'https://previews.test/pv-low-fade.jpg?token=2' }]);

    expect(prefetched()).toEqual([
      'https://previews.test/pv-low-fade.jpg?token=1',
      'https://previews.test/pv-low-fade.jpg?token=2',
    ]);
  });
});

describe('switching between finished previews', () => {
  it('swaps the big image on the tap, with no request and no loading state', async () => {
    await openPicker();
    // Every style is done, so no tile shows a loading line either.
    await emit([
      ...['low-fade', 'buzz-cut', 'quiff', 'stubble', 'goatee'].map((slug) => previewOf(slug, 'done')),
      pairPreview('quiff', 'goatee', 'done'),
    ]);
    const image = lookImage();

    await pick('hair', 'Degradê baixo');
    expect(imageUri(lookImage())).toBe('https://previews.test/pv-low-fade.jpg');

    await pick('hair', 'Topete');
    expect(imageUri(lookImage())).toBe('https://previews.test/pv-quiff.jpg');

    await pick('beard', 'Cavanhaque');
    expect(imageUri(lookImage())).toBe('https://previews.test/pv-quiff+goatee.jpg');

    // One image element throughout: the previous picture stays until the next is drawn.
    expect(lookImage()).toBe(image);
    // It reads the memory cache the prefetch filled, not the disk alone.
    expect(lookImage().props.cachePolicy).toBe('memory-disk');
    expect(api.requestPreview).not.toHaveBeenCalled();
    expect(screen.queryByText(strings.picker.preview.combining)).toBeNull();
    expect(screen.queryByText(strings.picker.tile.generating)).toBeNull();
  });

  it('requests a pair with no done preview and shows it combining', async () => {
    await openPicker();
    await emit([previewOf('low-fade', 'done'), previewOf('goatee', 'done')]);

    await pick('hair', 'Degradê baixo');
    await pick('beard', 'Cavanhaque');

    expect(api.requestPreview).toHaveBeenCalledWith({
      visitId: 'v1',
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-goatee',
      slot: 'front',
    });
    expect(await screen.findByText(strings.picker.preview.combining)).toBeOnTheScreen();
  });
});
