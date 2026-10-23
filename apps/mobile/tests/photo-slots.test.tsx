import type { PhotoSlot } from '@barber/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { DeliveryStatus, PhotoUpload, SlotUploads } from '@/api';
import { type PickResult, pickPhoto } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import { client, keepStyle, openVisit, rafa, uploadedPhoto, visit } from './support/fixtures';

// The camera and the gallery are the device's; each test scripts the shot.
jest.mock('@/lib/pick-photo');

function picked(name: string): PickResult {
  return { status: 'picked', image: { uri: `file:///camera/${name}.jpg`, width: 3024, height: 4032 } };
}

function slot(name: PhotoSlot) {
  return within(screen.getByLabelText(strings.photos.slots[name]));
}

function continueButton() {
  return screen.getByRole('button', { name: strings.photos.continue });
}

// The scripted upload queue: what it holds for the visit, reported to the
// slots screen's subscription.
let uploads: SlotUploads = {};
let onUploads: (slots: SlotUploads) => void = () => undefined;

function queued(shot: PhotoUpload, status: DeliveryStatus) {
  const { uri, width, height } = shot;
  uploads = { ...uploads, [shot.slot]: { status, image: { uri, width, height }, upload: { kind: 'photo', shot, take: 't' } } };
  onUploads(uploads);
}

beforeEach(() => {
  uploads = {};
  jest.mocked(pickPhoto).mockReset();
  jest.mocked(api.listVisitPhotos).mockResolvedValue([]);
  jest.mocked(api.subscribeToUploads).mockImplementation((_visitId, onChange) => {
    onUploads = onChange;
    return () => undefined;
  });
  // The queue sends every shot at once.
  jest.mocked(api.uploadPhoto).mockImplementation(async (shot) => queued(shot, 'sent'));
});

describe('photo slots', () => {
  it('uploads the front shot for slot front and continues only once it is uploaded', async () => {
    jest.mocked(api.uploadPhoto).mockImplementation(async (shot) => queued(shot, 'sending'));
    jest.mocked(pickPhoto).mockResolvedValue(picked('front'));
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    expect(await screen.findByText(strings.photos.title)).toBeOnTheScreen();
    for (const name of ['front', 'left', 'right', 'back'] as const) {
      expect(slot(name).getByText(strings.photos.status.empty)).toBeOnTheScreen();
    }
    expect(continueButton()).toBeDisabled();

    await fireEvent.press(slot('front').getByRole('button', { name: strings.photos.camera }));

    expect(pickPhoto).toHaveBeenCalledWith('camera');
    expect(api.uploadPhoto).toHaveBeenCalledWith({
      visitId: 'v1',
      slot: 'front',
      uri: 'file:///camera/front.jpg',
      width: 3024,
      height: 4032,
    });
    expect(await slot('front').findByText(strings.photos.status.uploading)).toBeOnTheScreen();
    expect(continueButton()).toBeDisabled();

    await act(async () => queued(jest.mocked(api.uploadPhoto).mock.calls[0]![0], 'sent'));

    expect(await slot('front').findByText(strings.photos.status.uploaded)).toBeOnTheScreen();
    await waitFor(() => expect(continueButton()).toBeEnabled());
  });

  it('uploads a retake for the same slot again', async () => {
    jest.mocked(pickPhoto).mockResolvedValueOnce(picked('first')).mockResolvedValueOnce(picked('retake'));
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    await fireEvent.press(await slot('front').findByRole('button', { name: strings.photos.camera }));
    expect(await slot('front').findByText(strings.photos.status.uploaded)).toBeOnTheScreen();
    await fireEvent.press(slot('front').getByRole('button', { name: strings.photos.gallery }));

    expect(pickPhoto).toHaveBeenLastCalledWith('gallery');
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledTimes(2));
    expect(api.uploadPhoto).toHaveBeenLastCalledWith(
      expect.objectContaining({ visitId: 'v1', slot: 'front', uri: 'file:///camera/retake.jpg' }),
    );
    expect(await slot('front').findByText(strings.photos.status.uploaded)).toBeOnTheScreen();
  });

  it('keeps continue disabled while only an optional slot is filled', async () => {
    jest.mocked(pickPhoto).mockResolvedValue(picked('left'));
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    await fireEvent.press(await slot('left').findByRole('button', { name: strings.photos.camera }));

    expect(await slot('left').findByText(strings.photos.status.uploaded)).toBeOnTheScreen();
    expect(api.uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({ slot: 'left' }));
    expect(continueButton()).toBeDisabled();
  });

  it('shows a shot that could not be queued as failed, with a retry that queues the same shot again', async () => {
    jest.mocked(api.uploadPhoto).mockRejectedValueOnce(new Error('storage full'));
    jest.mocked(pickPhoto).mockResolvedValue(picked('front'));
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    await fireEvent.press(await slot('front').findByRole('button', { name: strings.photos.camera }));

    expect(await slot('front').findByText(strings.photos.status.failed)).toBeOnTheScreen();
    expect(continueButton()).toBeDisabled();

    await fireEvent.press(slot('front').getByRole('button', { name: strings.photos.retry }));

    expect(await slot('front').findByText(strings.photos.status.uploaded)).toBeOnTheScreen();
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(jest.mocked(api.uploadPhoto).mock.calls[1]![0]).toEqual(jest.mocked(api.uploadPhoto).mock.calls[0]![0]);
    expect(pickPhoto).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(continueButton()).toBeEnabled());
  });

  it('says so when the camera is not allowed, and uploads nothing', async () => {
    jest.mocked(pickPhoto).mockResolvedValue({ status: 'denied' });
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    await fireEvent.press(await slot('front').findByRole('button', { name: strings.photos.camera }));

    expect(await screen.findByText(strings.photos.cameraDenied)).toBeOnTheScreen();
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it('resumes with the photos already uploaded, and continues to the picker', async () => {
    jest.mocked(api.getVisit).mockResolvedValue(openVisit());
    jest.mocked(api.getClient).mockResolvedValue(client());
    jest.mocked(api.listStyles).mockResolvedValue([keepStyle('hair'), keepStyle('beard')]);
    jest.mocked(api.subscribeToPreviews).mockReturnValue(() => undefined);
    jest.mocked(api.listVisitPhotos).mockResolvedValue([
      uploadedPhoto({ slot: 'front', url: 'https://storage.test/front.jpg' }),
      uploadedPhoto({ id: 'p2', slot: 'left', storagePath: 's1/v1/left.jpg', uploadStatus: 'uploading', url: null }),
    ]);
    const router = await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    expect(await slot('front').findByText(strings.photos.status.uploaded)).toBeOnTheScreen();
    expect(slot('left').getByText(strings.photos.status.empty)).toBeOnTheScreen();
    expect(api.listVisitPhotos).toHaveBeenCalledWith('v1');
    await waitFor(() => expect(continueButton()).toBeEnabled());

    await fireEvent.press(continueButton());

    expect(await screen.findByRole('tab', { name: strings.picker.tab.hair })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/visits/v1/picker');
  });
});

describe('home', () => {
  it("lists today's open visits, and tapping one opens its slots", async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(rafa);
    jest.mocked(api.listRecentVisits).mockResolvedValue([
      visit({ id: 'v7', clientName: 'Caio Prado', status: 'open', createdAt: '2026-10-22T13:00:00.000Z' }),
      visit({ id: 'v1', clientName: 'Ana Souza', status: 'closed', createdAt: '2026-10-20T15:00:00.000Z' }),
    ]);
    jest.mocked(api.listOpenVisitsToday).mockResolvedValue([
      visit({ id: 'v7', clientName: 'Caio Prado', status: 'open', createdAt: '2026-10-22T13:00:00.000Z' }),
    ]);
    const router = await renderRouter('./app', { initialUrl: '/' });

    expect(await screen.findByText(strings.home.openToday)).toBeOnTheScreen();
    // The open visit is listed once, under today's open visits.
    const caio = screen.getAllByLabelText('Caio Prado, 22/10/2026');
    expect(caio).toHaveLength(1);
    expect(screen.getByLabelText('Ana Souza, 20/10/2026')).toBeOnTheScreen();

    await fireEvent.press(caio[0]!);

    expect(await screen.findByText(strings.photos.title)).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/visits/v7/photos');
    expect(api.listVisitPhotos).toHaveBeenCalledWith('v7');
  });
});
