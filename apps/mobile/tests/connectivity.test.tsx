import type { Preview } from '@barber/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { Connectivity, SlotUploads } from '@/api';
import { type PreviewsTransport, previewFeed } from '@/api/previews';
import { type PickResult, pickPhoto } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { imageUri } from './support/image';
import { CATALOG, previewOf } from './support/picker';

// The camera and the gallery are the device's; each test scripts the shot.
jest.mock('@/lib/pick-photo');

const FRONT_SHOT = { uri: 'file:///camera/front.jpg', width: 3024, height: 4032 };

function picked(): PickResult {
  return { status: 'picked', image: FRONT_SHOT };
}

// The scripted queue and connection: the test emits what the `api` module
// would report.
let emitUploads: (slots: SlotUploads) => Promise<void> = async () => undefined;
let emitConnectivity: (connectivity: Connectivity) => Promise<void> = async () => undefined;

beforeEach(() => {
  jest.mocked(pickPhoto).mockReset();
  emitUploads = async () => undefined;
  emitConnectivity = async () => undefined;
  jest.mocked(api.subscribeToUploads).mockImplementation((_visitId, onChange) => {
    emitUploads = async (slots) => {
      await act(async () => onChange(slots));
    };
    return () => undefined;
  });
  jest.mocked(api.subscribeToConnectivity).mockImplementation((onChange) => {
    emitConnectivity = async (connectivity) => {
      await act(async () => onChange(connectivity));
    };
    onChange({ offline: false, queued: 0 });
    return () => undefined;
  });
});

function frontPhoto(status: 'sending' | 'waiting' | 'sent'): SlotUploads {
  return {
    front: {
      status,
      image: FRONT_SHOT,
      upload: { kind: 'photo', shot: { visitId: 'v1', slot: 'front', ...FRONT_SHOT }, take: 't1' },
    },
  };
}

function slot(name: 'front' | 'left') {
  return within(screen.getByLabelText(strings.photos.slots[name]));
}

function continueButton() {
  return screen.getByRole('button', { name: strings.photos.continue });
}

describe('the slots screen on bad wifi', () => {
  beforeEach(() => {
    jest.mocked(api.listVisitPhotos).mockResolvedValue([]);
    jest.mocked(api.uploadPhoto).mockResolvedValue(undefined);
  });

  it('shows a queued slot waiting for the connection, not failed, and uploaded once it is sent', async () => {
    jest.mocked(pickPhoto).mockResolvedValue(picked());
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    await fireEvent.press(await slot('front').findByRole('button', { name: strings.photos.camera }));
    expect(api.uploadPhoto).toHaveBeenCalledWith({ visitId: 'v1', slot: 'front', ...FRONT_SHOT });
    await emitUploads(frontPhoto('sending'));
    await emitUploads(frontPhoto('waiting'));
    await emitConnectivity({ offline: true, queued: 1 });

    expect(slot('front').getByText(strings.photos.status.waiting)).toBeOnTheScreen();
    expect(slot('front').queryByText(strings.photos.status.failed)).toBeNull();
    expect(slot('front').queryByRole('button', { name: strings.photos.retry })).toBeNull();
    expect(continueButton()).toBeDisabled();
    expect(screen.getByText(strings.connectivity.waiting(1))).toBeOnTheScreen();

    await emitUploads(frontPhoto('sent'));
    await emitConnectivity({ offline: false, queued: 0 });

    expect(slot('front').getByText(strings.photos.status.uploaded)).toBeOnTheScreen();
    await waitFor(() => expect(continueButton()).toBeEnabled());
    expect(screen.queryByText(strings.connectivity.waiting(1))).toBeNull();
  });

  it('shows a shot left queued by a closed app as waiting, with the shot', async () => {
    jest.mocked(api.subscribeToUploads).mockImplementation((_visitId, onChange) => {
      onChange(frontPhoto('waiting'));
      return () => undefined;
    });
    await renderRouter('./app', { initialUrl: '/visits/v1/photos' });

    expect(await slot('front').findByText(strings.photos.status.waiting)).toBeOnTheScreen();
    expect(slot('left').getByText(strings.photos.status.empty)).toBeOnTheScreen();
  });
});

// One visit's previews behind a connection the test drops and restores, fed
// to the picker through the real previews feed.
function flakyPreviews(initial: Preview[]) {
  let rows = initial;
  let down = false;
  const health: ((healthy: boolean) => void)[] = [];

  const transport: PreviewsTransport = {
    async list() {
      if (down) throw new Error('Network request failed');
      return rows;
    },
    async sign(paths) {
      return new Map(paths.map((path) => [path, `https://signed.test/${path}`]));
    },
    listen(_visitId, _onChange, onHealth) {
      health.push(onHealth);
      return () => undefined;
    },
  };

  return {
    transport,
    subscriptions: () => health.length,
    drop: async () => {
      down = true;
      await act(async () => health.at(-1)!(false));
    },
    restore: async (next: Preview[]) => {
      down = false;
      rows = next;
    },
    subscribed: async () => {
      await act(async () => health.at(-1)!(true));
    },
  };
}

describe('the picker on bad wifi', () => {
  beforeEach(() => {
    jest.mocked(api.getVisit).mockResolvedValue(openVisit());
    jest.mocked(api.getClient).mockResolvedValue(client());
    jest.mocked(api.listStyles).mockResolvedValue(CATALOG);
    jest.mocked(api.listVisitPhotos).mockResolvedValue([uploadedPhoto({ url: 'https://storage.test/front.jpg' })]);
  });

  it('subscribes again after a connection error and shows the previews done in the gap', async () => {
    const network = flakyPreviews([previewOf('low-fade', 'pending')]);
    // Long polls, so only the new subscription can catch up within the test.
    const subscribe = previewFeed(network.transport, { pollMs: 60_000, resubscribeMs: 20 });
    jest.mocked(api.subscribeToPreviews).mockImplementation(subscribe);
    await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
    await screen.findByRole('tab', { name: strings.picker.tab.hair });
    await network.subscribed();
    const tileImage = () => within(screen.getByRole('button', { name: 'Degradê baixo' })).getByTestId('tile-image');
    expect(imageUri(tileImage())).toBe('https://styles.test/hair/low-fade.png');

    await network.drop();
    await network.restore([previewOf('low-fade', 'done')]);

    await waitFor(() => expect(network.subscriptions()).toBe(2));
    await network.subscribed();

    await waitFor(() => expect(imageUri(tileImage())).toBe('https://signed.test/s1/v1/pv-low-fade.thumb.jpg'));
  });

  it('shows the connectivity indicator while the previews channel is down', async () => {
    jest.mocked(api.subscribeToPreviews).mockReturnValue(() => undefined);
    await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
    await screen.findByRole('tab', { name: strings.picker.tab.hair });
    expect(screen.queryByText(strings.connectivity.offline)).toBeNull();

    await emitConnectivity({ offline: true, queued: 0 });

    expect(screen.getByText(strings.connectivity.offline)).toBeOnTheScreen();
  });
});
