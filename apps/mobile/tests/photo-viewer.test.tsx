import type { PhotoSlot } from '@barber/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import * as api from '@/api';
import type { DeliveryStatus, PhotoUpload, SlotUploads } from '@/api';
import { DismissableModal } from '@/components/dismissable-modal';
import { type PickResult, pickPhoto } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import { uploadedPhoto } from './support/fixtures';
import { imageUri } from './support/image';

// The camera and the gallery are the device's; each test scripts the shot.
jest.mock('@/lib/pick-photo');

// The phone's status bar, as the safe-area inset a test sets.
let mockTopInset = 0;
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: mockTopInset, right: 0, bottom: 0, left: 0 }) };
});

const FRONT_URL = 'https://storage.test/front.jpg';

function picked(name: string): PickResult {
  return { status: 'picked', image: { uri: `file:///camera/${name}.jpg`, width: 3024, height: 4032 } };
}

// A drag on the modal's content, released where it ends.
async function drag(translationX: number, translationY: number) {
  await act(async () =>
    fireGestureHandler(getByGestureTestId('modal-dismiss'), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX, translationY },
      { state: State.END, translationX, translationY, velocityX: 0, velocityY: 0 },
    ]),
  );
}

function backArrow() {
  return screen.getByRole('button', { name: strings.modal.back });
}

describe('dismissable full-screen modal', () => {
  beforeEach(() => {
    mockTopInset = 0;
  });

  async function open(onClose = jest.fn()) {
    await render(
      <DismissableModal title="Frente" onClose={onClose}>
        <Text>conteúdo</Text>
      </DismissableModal>,
    );
    return onClose;
  }

  it('shows its title and content under a back arrow with a 44-point target', async () => {
    await open();

    expect(screen.getByText('Frente')).toBeOnTheScreen();
    expect(screen.getByText('conteúdo')).toBeOnTheScreen();
    expect(backArrow()).toHaveStyle({ width: 44, height: 44 });
  });

  it('puts the header below the status bar', async () => {
    mockTopInset = 47;
    await open();

    expect(screen.getByTestId('modal-header')).toHaveStyle({ paddingTop: 47 });
  });

  it('closes on the arrow', async () => {
    const onClose = await open();

    await fireEvent.press(backArrow());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a swipe down, and not on a short drag or a sideways one', async () => {
    const onClose = await open();

    await drag(0, 12);
    await drag(220, 8);
    await drag(0, 220);

    // The close reaches the JS thread a tick later; the two drags before it
    // would have closed first.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// The scripted upload queue: what it holds for the visit, reported to the
// slots screen's subscription.
let uploads: SlotUploads = {};
let onUploads: (slots: SlotUploads) => void = () => undefined;

function queued(shot: PhotoUpload, status: DeliveryStatus) {
  const { uri, width, height } = shot;
  uploads = { ...uploads, [shot.slot]: { status, image: { uri, width, height }, upload: { kind: 'photo', shot, take: 't' } } };
  onUploads(uploads);
}

function row(name: PhotoSlot) {
  return within(screen.getByLabelText(strings.photos.slots[name]));
}

function thumbnail(name: PhotoSlot) {
  return row(name).getByRole('button', { name: strings.photos.viewer.open(strings.photos.slots[name]) });
}

function viewer() {
  return within(screen.getByTestId('photo-viewer'));
}

async function openFront() {
  await renderRouter('./app', { initialUrl: '/visits/v1/photos' });
  await fireEvent.press(await waitFor(() => thumbnail('front')));
  expect(screen.getByTestId('photo-viewer')).toBeOnTheScreen();
}

describe('Fotos viewer', () => {
  beforeEach(() => {
    mockTopInset = 0;
    uploads = {};
    jest.mocked(pickPhoto).mockReset();
    jest.mocked(api.listVisitPhotos).mockResolvedValue([uploadedPhoto({ slot: 'front', url: FRONT_URL })]);
    jest.mocked(api.subscribeToUploads).mockImplementation((_visitId, onChange) => {
      onUploads = onChange;
      return () => undefined;
    });
    // The upload waits on the wifi: the row shows it uploading.
    jest.mocked(api.uploadPhoto).mockImplementation(async (shot) => queued(shot, 'sending'));
  });

  it("opens an uploaded angle's photo full screen under the angle's name", async () => {
    await openFront();

    expect(viewer().getByText(strings.photos.slots.front)).toBeOnTheScreen();
    expect(imageUri(viewer().getByTestId('photo-viewer-image'))).toBe(FRONT_URL);
    expect(viewer().getByRole('button', { name: strings.photos.camera })).toBeOnTheScreen();
    expect(viewer().getByRole('button', { name: strings.photos.gallery })).toBeOnTheScreen();
  });

  it('leaves the thumbnail of an angle with no photo without a press', async () => {
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });
    await waitFor(() => thumbnail('front'));

    const open = strings.photos.viewer.open(strings.photos.slots.left);
    expect(row('left').queryByRole('button', { name: open })).toBeNull();
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });

  it("retakes from the viewer's camera, closes it and shows the new shot uploading on the row", async () => {
    jest.mocked(pickPhoto).mockResolvedValue(picked('retake'));
    await openFront();

    await fireEvent.press(viewer().getByRole('button', { name: strings.photos.camera }));

    expect(pickPhoto).toHaveBeenCalledWith('camera');
    await waitFor(() => expect(screen.queryByTestId('photo-viewer')).toBeNull());
    expect(api.uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: 'v1', slot: 'front', uri: 'file:///camera/retake.jpg' }),
    );
    expect(await row('front').findByText(strings.photos.status.uploading)).toBeOnTheScreen();
    expect(imageUri(row('front').getByTestId('photo-thumbnail'))).toBe('file:///camera/retake.jpg');
  });

  it("retakes from the viewer's gallery the same way", async () => {
    jest.mocked(pickPhoto).mockResolvedValue(picked('library'));
    await openFront();

    await fireEvent.press(viewer().getByRole('button', { name: strings.photos.gallery }));

    expect(pickPhoto).toHaveBeenCalledWith('gallery');
    await waitFor(() => expect(screen.queryByTestId('photo-viewer')).toBeNull());
    expect(api.uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'front', uri: 'file:///camera/library.jpg' }),
    );
  });

  it('stays open when the pick is cancelled', async () => {
    jest.mocked(pickPhoto).mockResolvedValue({ status: 'cancelled' });
    await openFront();

    await fireEvent.press(viewer().getByRole('button', { name: strings.photos.camera }));

    expect(pickPhoto).toHaveBeenCalledWith('camera');
    expect(screen.getByTestId('photo-viewer')).toBeOnTheScreen();
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it('says in the viewer when the camera is not allowed', async () => {
    jest.mocked(pickPhoto).mockResolvedValue({ status: 'denied' });
    await openFront();

    await fireEvent.press(viewer().getByRole('button', { name: strings.photos.camera }));

    expect(await viewer().findByText(strings.photos.cameraDenied)).toBeOnTheScreen();
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it('closes on the arrow', async () => {
    await openFront();

    await fireEvent.press(viewer().getByRole('button', { name: strings.modal.back }));

    expect(screen.queryByTestId('photo-viewer')).toBeNull();
    expect(row('front').getByText(strings.photos.status.uploaded)).toBeOnTheScreen();
  });

  it('closes on a swipe down', async () => {
    await openFront();

    await drag(0, 220);

    await waitFor(() => expect(screen.queryByTestId('photo-viewer')).toBeNull());
  });
});
