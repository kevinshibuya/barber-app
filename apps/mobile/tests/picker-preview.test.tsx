import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { VisitPreview } from '@/api';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { CATALOG, pairPreview, previewOf } from './support/picker';

const FRONT_URL = 'https://storage.test/front.jpg';
const LEFT_URL = 'https://storage.test/left.jpg';

// The scripted subscription: the test emits the visit's previews.
let emit: (previews: VisitPreview[]) => Promise<void> = async () => undefined;

beforeEach(() => {
  emit = async () => undefined;
  jest.mocked(api.getVisit).mockResolvedValue(openVisit());
  jest.mocked(api.getClient).mockResolvedValue(client());
  jest.mocked(api.listStyles).mockResolvedValue(CATALOG);
  jest
    .mocked(api.listVisitPhotos)
    .mockResolvedValue([
      uploadedPhoto({ url: FRONT_URL }),
      uploadedPhoto({ id: 'p2', slot: 'left', storagePath: 's1/v1/left.jpg', url: LEFT_URL }),
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

async function showTab(dimension: 'hair' | 'beard') {
  await fireEvent.press(screen.getByRole('tab', { name: strings.picker.tab[dimension] }));
}

async function pick(dimension: 'hair' | 'beard', name: string) {
  await showTab(dimension);
  await fireEvent.press(screen.getByRole('button', { name }));
}

function lookImage() {
  return screen.getByTestId('look-image');
}

function chooseButton() {
  return screen.getByRole('button', { name: strings.picker.choose });
}

function fullScreen() {
  return within(screen.getByTestId('full-screen-preview'));
}

async function openFullScreen() {
  await fireEvent.press(screen.getByRole('button', { name: strings.picker.a11y.openPreview }));
  return fullScreen();
}

// A swipe that settles on the page.
async function swipeTo(page: number) {
  const { width } = Dimensions.get('window');
  await fireEvent(fullScreen().getByTestId('angle-pager'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: page * width, y: 0 } },
  });
}

const PRE_RENDERED = [previewOf('low-fade', 'done'), previewOf('goatee', 'done')];

describe('hair-plus-beard combinations', () => {
  it('requests the combination and shows the hair preview, combining, until it is done', async () => {
    await openPicker();
    await emit(PRE_RENDERED);

    await pick('hair', 'Degradê baixo');
    expect(api.requestPreview).not.toHaveBeenCalled();
    await pick('beard', 'Cavanhaque');

    expect(api.requestPreview).toHaveBeenCalledWith({
      visitId: 'v1',
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-goatee',
      slot: 'front',
    });
    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.jpg' });
    expect(await screen.findByText(strings.picker.preview.combining)).toBeOnTheScreen();
    expect(chooseButton()).toBeDisabled();

    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'running')]);
    expect(screen.getByText(strings.picker.preview.combining)).toBeOnTheScreen();

    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'done')]);

    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade+goatee.jpg' });
    expect(screen.queryByText(strings.picker.preview.combining)).toBeNull();
    await waitFor(() => expect(chooseButton()).toBeEnabled());
  });

  it('shows a refused combination over the hair preview, which stays a tap on beard keep from chosen', async () => {
    await openPicker();
    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'refused')]);

    await pick('hair', 'Degradê baixo');
    await pick('beard', 'Cavanhaque');

    expect(screen.getByText(strings.picker.preview.comboRefused)).toBeOnTheScreen();
    expect(screen.queryByText(strings.picker.preview.combining)).toBeNull();
    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.jpg' });
    expect(chooseButton()).toBeDisabled();
    await fireEvent.press(chooseButton());
    expect(api.chooseLook).not.toHaveBeenCalled();
    expect(api.retryPreview).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: strings.picker.tile.keep }));

    expect(screen.queryByText(strings.picker.preview.comboRefused)).toBeNull();
    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.jpg' });
    await waitFor(() => expect(chooseButton()).toBeEnabled());
    await fireEvent.press(chooseButton());

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-keep',
      previewId: 'pv-low-fade',
    });
  });

  it('retries a failed combination from a tap on the preview', async () => {
    jest.mocked(api.retryPreview).mockResolvedValue(pairPreview('low-fade', 'goatee', 'pending'));
    await openPicker();
    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'failed')]);

    await pick('hair', 'Degradê baixo');
    await pick('beard', 'Cavanhaque');
    await fireEvent.press(screen.getByRole('button', { name: strings.picker.tile.failed }));

    expect(api.retryPreview).toHaveBeenCalledWith('pv-low-fade+goatee');
    expect(await screen.findByText(strings.picker.preview.combining)).toBeOnTheScreen();
  });
});

describe('the full-screen preview', () => {
  it('opens on the front, and a swipe asks for the next angle and waits for it', async () => {
    await openPicker();
    await emit(PRE_RENDERED);
    await pick('hair', 'Degradê baixo');

    const view = await openFullScreen();

    expect(view.getByRole('tab', { name: strings.picker.angle.front })).toBeSelected();
    expect(view.getByRole('tab', { name: strings.picker.angle.left })).not.toBeSelected();
    expect(view.queryByRole('tab', { name: strings.picker.angle.right })).toBeNull();
    expect(view.getByTestId('angle-image-front')).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.jpg' });
    expect(api.requestPreview).not.toHaveBeenCalled();

    await swipeTo(1);

    expect(api.requestPreview).toHaveBeenCalledTimes(1);
    expect(api.requestPreview).toHaveBeenCalledWith({
      visitId: 'v1',
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-keep',
      slot: 'left',
    });
    expect(view.getByRole('tab', { name: strings.picker.angle.left })).toBeSelected();
    expect(view.getByTestId('angle-image-left')).toHaveProp('source', { uri: LEFT_URL });
    expect(await view.findByText(strings.picker.angle.generating)).toBeOnTheScreen();
    expect(view.getByRole('button', { name: strings.picker.choose })).toBeDisabled();

    await emit([...PRE_RENDERED, pairPreview('low-fade', 'keep', 'running', { slot: 'left' })]);
    expect(view.getByText(strings.picker.angle.generating)).toBeOnTheScreen();

    await emit([...PRE_RENDERED, pairPreview('low-fade', 'keep', 'done', { slot: 'left' })]);

    expect(view.getByTestId('angle-image-left')).toHaveProp('source', {
      uri: 'https://previews.test/pv-low-fade@left.jpg',
    });
    expect(view.queryByText(strings.picker.angle.generating)).toBeNull();
    expect(api.requestPreview).toHaveBeenCalledTimes(1);
  });

  it('shows a refused angle without retrying, and closes back to the same selection', async () => {
    await openPicker();
    await emit([...PRE_RENDERED, pairPreview('low-fade', 'keep', 'refused', { slot: 'left' })]);
    await pick('hair', 'Degradê baixo');

    const view = await openFullScreen();
    await fireEvent.press(view.getByRole('tab', { name: strings.picker.angle.left }));

    expect(view.getByText(strings.picker.tile.refused)).toBeOnTheScreen();
    expect(api.requestPreview).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: strings.picker.choose })).toBeDisabled();

    await fireEvent.press(view.getByRole('button', { name: strings.picker.a11y.back }));

    expect(screen.queryByTestId('full-screen-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Degradê baixo' })).toBeSelected();
    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.jpg' });
  });

  it('chooses the combination from full screen with its preview id', async () => {
    await openPicker();
    await emit([...PRE_RENDERED, pairPreview('low-fade', 'goatee', 'done')]);
    await pick('hair', 'Degradê baixo');
    await pick('beard', 'Cavanhaque');

    const view = await openFullScreen();

    expect(view.getByTestId('angle-image-front')).toHaveProp('source', {
      uri: 'https://previews.test/pv-low-fade+goatee.jpg',
    });
    await fireEvent.press(view.getByRole('button', { name: strings.picker.choose }));

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-goatee',
      previewId: 'pv-low-fade+goatee',
    });
    expect(await screen.findByText(strings.finish.title)).toBeOnTheScreen();
    expect(screen.queryByTestId('full-screen-preview')).toBeNull();
  });
});
