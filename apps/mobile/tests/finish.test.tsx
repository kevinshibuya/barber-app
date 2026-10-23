import { fireEvent, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { type PickResult, pickPhoto } from '@/lib/pick-photo';
import { strings } from '@/lib/strings';
import { openVisit } from './support/fixtures';

jest.mock('@/lib/pick-photo');

const LOOK_URL = 'https://previews.test/pv-low-fade.jpg';

let share: jest.SpyInstance;

beforeEach(() => {
  process.env.EXPO_PUBLIC_CLIENT_PAGE_BASE_URL = 'https://barber.test';
  share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  jest.mocked(pickPhoto).mockReset();
  jest.mocked(api.getVisitDetail).mockResolvedValue({
    visit: openVisit({ chosenHairStyleId: 'hair-low-fade', chosenBeardStyleId: 'beard-keep', chosenPreviewId: 'pv-low-fade' }),
    lookImageUrl: LOOK_URL,
    afterPhotoUrl: null,
  });
});

async function openFinish() {
  await renderRouter('./app', { initialUrl: '/visits/v1/finish' });
  await screen.findByTestId('look-image');
}

describe('closing a visit', () => {
  it('closes without an after photo', async () => {
    jest
      .mocked(api.closeVisit)
      .mockResolvedValue(openVisit({ status: 'closed', closedAt: '2026-10-22T15:00:00.000Z' }));
    await openFinish();

    expect(screen.getByTestId('look-image')).toHaveProp('source', { uri: LOOK_URL });
    await fireEvent.press(screen.getByRole('button', { name: strings.finish.close }));

    expect(api.closeVisit).toHaveBeenCalledWith('v1');
    expect(await screen.findByText(strings.finish.closed)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: strings.finish.close })).toBeNull();
  });
});

describe('the after photo', () => {
  const shot: PickResult = { status: 'picked', image: { uri: 'file:///after.jpg', width: 3000, height: 4000 } };

  it('uploads to the visit and locks the look', async () => {
    jest.mocked(pickPhoto).mockResolvedValue(shot);
    jest.mocked(api.uploadAfterPhoto).mockResolvedValue(openVisit({ afterPhotoPath: 's1/v1/after.jpg' }));
    await openFinish();
    expect(screen.getByRole('button', { name: strings.finish.changeLook })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: strings.finish.takeAfter }));

    expect(pickPhoto).toHaveBeenCalledWith('camera');
    expect(api.uploadAfterPhoto).toHaveBeenCalledWith('v1', {
      uri: 'file:///after.jpg',
      width: 3000,
      height: 4000,
    });
    expect(await screen.findByTestId('after-image')).toHaveProp('source', { uri: 'file:///after.jpg' });
    expect(screen.queryByRole('button', { name: strings.finish.changeLook })).toBeNull();
    expect(screen.getByRole('button', { name: strings.finish.close })).toBeOnTheScreen();
  });

  it('keeps the look changeable when the upload fails', async () => {
    jest.mocked(pickPhoto).mockResolvedValue(shot);
    jest.mocked(api.uploadAfterPhoto).mockRejectedValue(new Error('network down'));
    await openFinish();

    await fireEvent.press(screen.getByRole('button', { name: strings.finish.takeAfter }));

    expect(await screen.findByText(strings.finish.afterFailed)).toBeOnTheScreen();
    expect(screen.queryByTestId('after-image')).toBeNull();
    expect(screen.getByRole('button', { name: strings.finish.changeLook })).toBeOnTheScreen();
  });
});

describe('sending the client page', () => {
  it('opens the share sheet with the visit link and a pt-BR message', async () => {
    jest.mocked(api.getVisitDetail).mockResolvedValue({
      visit: openVisit({ shareToken: 'Zq3-token_43' }),
      lookImageUrl: LOOK_URL,
      afterPhotoUrl: null,
    });
    await openFinish();

    await fireEvent.press(screen.getByRole('button', { name: strings.finish.share }));

    expect(share).toHaveBeenCalledWith({
      message: 'Olá! Veja as prévias do seu corte: https://barber.test/v/Zq3-token_43',
    });
  });

  it('says the link expired once the token is cleared', async () => {
    jest.mocked(api.getVisitDetail).mockResolvedValue({
      visit: openVisit({ status: 'closed', shareToken: null, shareExpiresAt: null }),
      lookImageUrl: LOOK_URL,
      afterPhotoUrl: null,
    });
    await openFinish();

    expect(screen.getByText(strings.finish.shareExpired)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: strings.finish.share })).toBeDisabled();
  });
});

describe('a closed visit', () => {
  it('opens read-only, with its after photo and the share action', async () => {
    jest.mocked(api.getVisitDetail).mockResolvedValue({
      visit: openVisit({
        status: 'closed',
        closedAt: '2026-10-22T15:00:00.000Z',
        chosenHairStyleId: 'hair-low-fade',
        chosenBeardStyleId: 'beard-keep',
        chosenPreviewId: 'pv-low-fade',
        afterPhotoPath: 's1/v1/after.jpg',
      }),
      lookImageUrl: LOOK_URL,
      afterPhotoUrl: 'https://storage.test/after.jpg',
    });
    await openFinish();

    expect(screen.getByText(strings.finish.closed)).toBeOnTheScreen();
    expect(screen.getByTestId('look-image')).toHaveProp('source', { uri: LOOK_URL });
    expect(screen.getByTestId('after-image')).toHaveProp('source', { uri: 'https://storage.test/after.jpg' });
    for (const action of [strings.finish.close, strings.finish.takeAfter, strings.finish.retakeAfter, strings.finish.changeLook]) {
      expect(screen.queryByRole('button', { name: action })).toBeNull();
    }

    await fireEvent.press(screen.getByRole('button', { name: strings.finish.share }));

    expect(share).toHaveBeenCalledWith({ message: 'Olá! Veja as prévias do seu corte: https://barber.test/v/token' });
  });
});
