import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import * as api from '@/api';
import type { VisitPreview } from '@/api';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { imageUri } from './support/image';
import { CATALOG, pairPreview, previewOf } from './support/picker';

const FRONT = uploadedPhoto({ url: 'https://storage.test/front.jpg' });
const LEFT = uploadedPhoto({ id: 'p2', slot: 'left', storagePath: 's1/v1/left.jpg', url: 'https://storage.test/left.jpg' });

// The phone's status bar and home indicator, as the safe-area insets a test sets.
let mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => mockInsets };
});

// The scripted subscription: the test emits the visit's previews.
let emit: (previews: VisitPreview[]) => Promise<void> = async () => undefined;

beforeEach(() => {
  mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
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
});

// Low fade is done on both angles, so nothing on screen needs a request.
const LOW_FADE_DONE = [previewOf('low-fade', 'done'), pairPreview('low-fade', 'keep', 'done', { slot: 'left' })];

function fullScreen() {
  return within(screen.getByTestId('full-screen-preview'));
}

// A swipe that settles on the page, on the picker or inside full screen.
async function swipeTo(position: number, scope: Pick<typeof screen, 'getByTestId'> = screen) {
  await fireEvent(scope.getByTestId('angle-pager'), 'pageSelected', { nativeEvent: { position } });
}

// A drag on the full-screen photo, released where it ends.
async function drag(translationX: number, translationY: number) {
  await act(async () =>
    fireGestureHandler(getByGestureTestId('modal-dismiss'), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX, translationY },
      { state: State.END, translationX, translationY, velocityX: 0, velocityY: 0 },
    ]),
  );
}

// The picker on the left angle with low fade selected, then full screen.
async function openOnLeft() {
  await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
  await screen.findByRole('tab', { name: strings.picker.tab.hair });
  await emit(LOW_FADE_DONE);
  await fireEvent.press(screen.getByRole('button', { name: 'Degradê baixo' }));
  await swipeTo(1);
  await fireEvent.press(screen.getByRole('button', { name: strings.picker.a11y.openPreview }));
  return fullScreen();
}

describe('leaving the full-screen preview', () => {
  it('puts the header below the status bar, with a 44-point back arrow', async () => {
    mockInsets = { top: 47, right: 0, bottom: 34, left: 0 };
    const view = await openOnLeft();

    expect(view.getByTestId('modal-header')).toHaveStyle({ paddingTop: 47 });
    expect(view.getByRole('button', { name: strings.modal.back })).toHaveStyle({ width: 44, height: 44 });
  });

  it('closes on a swipe down onto the angle it was on, with the same selection', async () => {
    await openOnLeft();

    await drag(0, 220);

    await waitFor(() => expect(screen.queryByTestId('full-screen-preview')).toBeNull());
    expect(screen.getByRole('tab', { name: strings.picker.angle.left })).toBeSelected();
    expect(imageUri(screen.getByTestId('look-image'))).toBe('https://previews.test/pv-low-fade@left.jpg');
    expect(screen.getByRole('button', { name: 'Degradê baixo' })).toBeSelected();
  });

  it('stays open on a sideways drag, which pages, and closes onto the angle it paged to', async () => {
    const view = await openOnLeft();

    await drag(220, 8);
    await swipeTo(0, view);

    expect(screen.getByTestId('full-screen-preview')).toBeOnTheScreen();
    expect(view.getByRole('tab', { name: strings.picker.angle.front })).toBeSelected();
    expect(imageUri(view.getByTestId('angle-image-front'))).toBe('https://previews.test/pv-low-fade.jpg');

    await drag(0, 220);

    await waitFor(() => expect(screen.queryByTestId('full-screen-preview')).toBeNull());
    expect(screen.getByRole('tab', { name: strings.picker.angle.front })).toBeSelected();
    expect(imageUri(screen.getByTestId('look-image'))).toBe('https://previews.test/pv-low-fade.jpg');
    expect(screen.getByRole('button', { name: 'Degradê baixo' })).toBeSelected();
  });
});
