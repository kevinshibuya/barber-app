import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { VisitPhoto, VisitPreview } from '@/api';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { imageUri } from './support/image';
import { CATALOG, pairPreview, previewOf } from './support/picker';

const FRONT_URL = 'https://storage.test/front.jpg';
const LEFT_URL = 'https://storage.test/left.jpg';

const FRONT = uploadedPhoto({ url: FRONT_URL });
const LEFT = uploadedPhoto({ id: 'p2', slot: 'left', storagePath: 's1/v1/left.jpg', url: LEFT_URL });

// The scripted subscription: the test emits the visit's previews.
let emit: (previews: VisitPreview[]) => Promise<void> = async () => undefined;

beforeEach(() => {
  emit = async () => undefined;
  jest.mocked(api.getVisit).mockResolvedValue(openVisit());
  jest.mocked(api.getClient).mockResolvedValue(client());
  jest.mocked(api.listStyles).mockResolvedValue(CATALOG);
  jest.mocked(api.listVisitPhotos).mockResolvedValue([FRONT, LEFT]);
  jest.mocked(api.subscribeToPreviews).mockImplementation((_visitId, onChange) => {
    emit = async (previews) => {
      await act(async () => onChange(previews));
    };
    return jest.fn();
  });
  // The database answers a request with the pair's row, pending when new.
  jest.mocked(api.requestPreview).mockImplementation(async ({ hairStyleId, beardStyleId, slot }) =>
    pairPreview(hairStyleId.replace('hair-', ''), beardStyleId.replace('beard-', ''), 'pending', { slot }),
  );
});

async function openPicker(photos?: VisitPhoto[]) {
  if (photos) jest.mocked(api.listVisitPhotos).mockResolvedValue(photos);
  await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
  await screen.findByRole('tab', { name: strings.picker.tab.hair });
}

function pills() {
  return within(screen.getByLabelText(strings.picker.a11y.angles));
}

function pill(name: string) {
  return screen.getByRole('tab', { name });
}

function tile(name: string) {
  return screen.getByRole('button', { name });
}

function tileImage(name: string) {
  return within(tile(name)).getByTestId('tile-image');
}

function lookImage() {
  return screen.getByTestId('look-image');
}

async function pick(name: string) {
  await fireEvent.press(tile(name));
}

// A swipe that settles on the page, on the picker or inside full screen.
async function swipeTo(position: number, scope: Pick<typeof screen, 'getByTestId'> = screen) {
  await fireEvent(scope.getByTestId('angle-pager'), 'pageSelected', { nativeEvent: { position } });
}

function fullScreen() {
  return within(screen.getByTestId('full-screen-preview'));
}

// Low fade is done on both angles, so nothing on screen needs a request.
const LOW_FADE_DONE = [previewOf('low-fade', 'done'), pairPreview('low-fade', 'keep', 'done', { slot: 'left' })];

describe('the picker angle pager', () => {
  it('has one page and one pill per uploaded angle, opening on the front', async () => {
    await openPicker();

    expect(screen.getByTestId('angle-page-front')).toBeOnTheScreen();
    expect(screen.getByTestId('angle-page-left')).toBeOnTheScreen();
    expect(screen.queryByTestId('angle-page-right')).toBeNull();
    expect(screen.queryByTestId('angle-page-back')).toBeNull();
    expect(pill(strings.picker.angle.front)).toBeSelected();
    expect(pill(strings.picker.angle.left)).not.toBeSelected();
    expect(pills().getAllByRole('tab')).toHaveLength(2);
    expect(imageUri(screen.getByTestId('look-image'))).toBe(FRONT_URL);
  });

  it('has a single page and pill when only the front is uploaded', async () => {
    await openPicker([FRONT]);

    expect(screen.getByTestId('angle-page-front')).toBeOnTheScreen();
    expect(screen.queryByTestId('angle-page-left')).toBeNull();
    expect(pills().getAllByRole('tab')).toHaveLength(1);
    expect(pill(strings.picker.angle.front)).toBeSelected();
  });

  it('follows a swipe and a pill tap with the pills, the big image and the grid, keeping the selection', async () => {
    await openPicker();
    await emit(LOW_FADE_DONE);
    await pick('Degradê baixo');

    await swipeTo(1);

    expect(pill(strings.picker.angle.left)).toBeSelected();
    expect(pill(strings.picker.angle.front)).not.toBeSelected();
    expect(imageUri(lookImage())).toBe('https://previews.test/pv-low-fade@left.jpg');
    expect(imageUri(tileImage('Degradê baixo'))).toBe('https://previews.test/pv-low-fade@left.thumb.jpg');
    expect(imageUri(tileImage(strings.picker.tile.keep))).toBe(LEFT_URL);
    expect(imageUri(tileImage('Topete'))).toBe('https://styles.test/hair/quiff.png');
    // Nothing renders Topete on this angle until it is tapped, so it does not say generating.
    expect(within(tile('Topete')).getByText(strings.picker.tile.unrequested)).toBeOnTheScreen();
    expect(within(tile('Topete')).queryByText(strings.picker.tile.generating)).toBeNull();
    expect(tile('Degradê baixo')).toBeSelected();

    await fireEvent.press(pill(strings.picker.angle.front));

    expect(pill(strings.picker.angle.front)).toBeSelected();
    expect(pill(strings.picker.angle.left)).not.toBeSelected();
    expect(imageUri(lookImage())).toBe('https://previews.test/pv-low-fade.jpg');
    expect(imageUri(tileImage('Degradê baixo'))).toBe('https://previews.test/pv-low-fade.thumb.jpg');
    expect(imageUri(tileImage(strings.picker.tile.keep))).toBe(FRONT_URL);
    expect(tile('Degradê baixo')).toBeSelected();
    // The selected pair is done on both angles: nothing was asked for.
    expect(api.requestPreview).not.toHaveBeenCalled();
  });

  it('asks once for the selected look on arrival at an angle that lacks it, and for nothing else', async () => {
    await openPicker();
    await emit([previewOf('low-fade', 'done')]);
    await pick('Degradê baixo');
    expect(api.requestPreview).not.toHaveBeenCalled();

    await swipeTo(1);

    expect(api.requestPreview).toHaveBeenCalledTimes(1);
    expect(api.requestPreview).toHaveBeenCalledWith({
      visitId: 'v1',
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-keep',
      slot: 'left',
    });
    expect(imageUri(lookImage())).toBe(LEFT_URL);
    expect(await screen.findByText(strings.picker.angle.generating)).toBeOnTheScreen();

    await fireEvent.press(pill(strings.picker.angle.front));
    await swipeTo(1);

    expect(api.requestPreview).toHaveBeenCalledTimes(1);
  });

  it('shows a tile pending on the current angle as generating, then its thumbnail, and large once tapped', async () => {
    await openPicker();
    await swipeTo(1);
    await emit([pairPreview('low-fade', 'keep', 'pending', { slot: 'left' })]);

    expect(imageUri(tileImage('Degradê baixo'))).toBe('https://styles.test/hair/low-fade.png');
    expect(within(tile('Degradê baixo')).getByText(strings.picker.tile.generating)).toBeOnTheScreen();

    await emit([pairPreview('low-fade', 'keep', 'done', { slot: 'left' })]);

    expect(imageUri(tileImage('Degradê baixo'))).toBe('https://previews.test/pv-low-fade@left.thumb.jpg');
    expect(within(tile('Degradê baixo')).queryByText(strings.picker.tile.generating)).toBeNull();

    await pick('Degradê baixo');

    expect(imageUri(lookImage())).toBe('https://previews.test/pv-low-fade@left.jpg');
    expect(api.requestPreview).not.toHaveBeenCalled();
  });
});

describe('full screen across angles', () => {
  it('opens on the picker angle, pages with the same pills, and closes onto the angle it was on', async () => {
    await openPicker();
    await emit(LOW_FADE_DONE);
    await pick('Degradê baixo');
    await swipeTo(1);

    await fireEvent.press(screen.getByRole('button', { name: strings.picker.a11y.openPreview }));
    const view = fullScreen();

    expect(view.getByRole('tab', { name: strings.picker.angle.left })).toBeSelected();
    expect(view.getByRole('tab', { name: strings.picker.angle.front })).not.toBeSelected();
    expect(imageUri(view.getByTestId('angle-image-left'))).toBe('https://previews.test/pv-low-fade@left.jpg');

    await swipeTo(0, view);
    expect(view.getByRole('tab', { name: strings.picker.angle.front })).toBeSelected();
    await fireEvent.press(view.getByRole('tab', { name: strings.picker.angle.left }));
    expect(view.getByRole('tab', { name: strings.picker.angle.left })).toBeSelected();
    await swipeTo(0, view);

    await fireEvent.press(view.getByRole('button', { name: strings.picker.a11y.back }));

    expect(screen.queryByTestId('full-screen-preview')).toBeNull();
    expect(pill(strings.picker.angle.front)).toBeSelected();
    expect(imageUri(lookImage())).toBe('https://previews.test/pv-low-fade.jpg');
    expect(tile('Degradê baixo')).toBeSelected();
    expect(api.requestPreview).not.toHaveBeenCalled();
  });
});
