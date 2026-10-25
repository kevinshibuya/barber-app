import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { VisitPreview } from '@/api';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { CATALOG, pairPreview, previewOf } from './support/picker';

// The lock diagnosed on #31: the look was never locked, the pill was waiting on
// a render and did not say so. The pill now names what it waits on.

// The scripted subscription: the test emits the visit's previews.
let emit: (previews: VisitPreview[]) => Promise<void> = async () => undefined;

const CHOSEN_LOW_FADE = { chosenHairStyleId: 'hair-low-fade', chosenBeardStyleId: 'beard-keep', chosenPreviewId: 'pv-low-fade' };

beforeEach(() => {
  emit = async () => undefined;
  jest.mocked(api.getVisit).mockResolvedValue(openVisit(CHOSEN_LOW_FADE));
  jest.mocked(api.getClient).mockResolvedValue(client());
  jest.mocked(api.listStyles).mockResolvedValue(CATALOG);
  jest
    .mocked(api.listVisitPhotos)
    .mockResolvedValue([
      uploadedPhoto({ url: 'https://storage.test/front.jpg' }),
      uploadedPhoto({ id: 'p2', slot: 'left', storagePath: 's1/v1/left.jpg', url: 'https://storage.test/left.jpg' }),
    ]);
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
  jest.mocked(api.chooseLook).mockResolvedValue(openVisit());
  // Choosing goes on to the finish screen, which reads the visit again.
  jest.mocked(api.getVisitDetail).mockResolvedValue({ visit: openVisit(), lookImageUrl: null, afterPhotoUrl: null });
});

async function openPicker() {
  await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
  await screen.findByRole('tab', { name: strings.picker.tab.hair });
}

async function pick(dimension: 'hair' | 'beard', name: string) {
  await fireEvent.press(screen.getByRole('tab', { name: strings.picker.tab[dimension] }));
  await fireEvent.press(screen.getByRole('button', { name }));
}

async function openFullScreen() {
  await fireEvent.press(screen.getByRole('button', { name: strings.picker.a11y.openPreview }));
  return within(screen.getByTestId('full-screen-preview'));
}

const PRE_RENDERED = [previewOf('low-fade', 'done'), previewOf('goatee', 'done')];

describe('the choose pill on a chosen look', () => {
  it('a chosen look changed to a combination says it is generating, then chooses it', async () => {
    await openPicker();
    await emit(PRE_RENDERED);

    expect(screen.getByRole('button', { name: strings.picker.chosen })).toBeDisabled();

    await pick('beard', 'Cavanhaque');

    expect(screen.getByRole('button', { name: strings.picker.choosePending })).toBeDisabled();
    expect(screen.queryByRole('button', { name: strings.picker.choose })).toBeNull();

    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'done')]);

    await waitFor(() => expect(screen.getByRole('button', { name: strings.picker.choose })).toBeEnabled());
    await fireEvent.press(screen.getByRole('button', { name: strings.picker.choose }));

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-goatee',
      previewId: 'pv-low-fade+goatee',
    });
  });

  it('says the left angle of a combination is generating until its row is done', async () => {
    await openPicker();
    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'done')]);
    await pick('beard', 'Cavanhaque');

    const view = await openFullScreen();
    expect(view.getByRole('button', { name: strings.picker.choose })).toBeEnabled();

    await fireEvent(view.getByTestId('angle-pager'), 'pageSelected', { nativeEvent: { position: 1 } });

    expect(view.getByRole('button', { name: strings.picker.choosePending })).toBeDisabled();
    expect(view.queryByRole('button', { name: strings.picker.choose })).toBeNull();

    await emit([
      ...PRE_RENDERED,
      pairPreview('low-fade', 'goatee', 'done'),
      pairPreview('low-fade', 'goatee', 'done', { slot: 'left' }),
    ]);

    await waitFor(() => expect(view.getByRole('button', { name: strings.picker.choose })).toBeEnabled());
  });

  it('says the look is locked once the after photo is taken', async () => {
    jest.mocked(api.getVisit).mockResolvedValue(
      openVisit({
        chosenHairStyleId: 'hair-buzz-cut',
        chosenBeardStyleId: 'beard-keep',
        chosenPreviewId: 'pv-buzz-cut',
        afterPhotoPath: 's1/v1/after.jpg',
      }),
    );
    await openPicker();
    await emit([previewOf('buzz-cut', 'done'), previewOf('quiff', 'done')]);

    expect(screen.getByRole('button', { name: strings.picker.chosen })).toBeDisabled();

    await pick('hair', 'Topete');

    expect(screen.getByRole('button', { name: strings.picker.locked.afterPhoto })).toBeDisabled();
    expect(screen.queryByRole('button', { name: strings.picker.choose })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: strings.picker.locked.afterPhoto }));
    expect(api.chooseLook).not.toHaveBeenCalled();
  });

  it('says the visit is closed, not that it has an after photo, on a visit closed without one', async () => {
    jest.mocked(api.getVisit).mockResolvedValue(
      openVisit({ ...CHOSEN_LOW_FADE, status: 'closed', closedAt: '2026-10-22T15:00:00.000Z' }),
    );
    await openPicker();
    await emit([previewOf('low-fade', 'done'), previewOf('quiff', 'done')]);

    await pick('hair', 'Topete');

    expect(screen.getByRole('button', { name: strings.picker.locked.closed })).toBeDisabled();
    expect(screen.queryByRole('button', { name: strings.picker.locked.afterPhoto })).toBeNull();
  });
});
