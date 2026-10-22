import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { VisitPreview } from '@/api';
import { strings } from '@/lib/strings';
import { client, openVisit, uploadedPhoto } from './support/fixtures';
import { CATALOG, previewOf } from './support/picker';

const FRONT_URL = 'https://storage.test/front.jpg';

const HAIR_STYLES = ['Degradê baixo', 'Máquina', 'Topete'];
const BEARD_STYLES = ['Barba por fazer', 'Cavanhaque'];

// The scripted subscription: the test emits the visit's previews.
let emit: (previews: VisitPreview[]) => Promise<void> = async () => undefined;
const unsubscribe = jest.fn();

beforeEach(() => {
  emit = async () => undefined;
  unsubscribe.mockReset();
  jest.mocked(api.getVisit).mockResolvedValue(openVisit());
  jest.mocked(api.getClient).mockResolvedValue(client());
  jest.mocked(api.listStyles).mockResolvedValue(CATALOG);
  jest.mocked(api.listVisitPhotos).mockResolvedValue([uploadedPhoto({ url: FRONT_URL })]);
  jest.mocked(api.subscribeToPreviews).mockImplementation((_visitId, onChange) => {
    emit = async (previews) => {
      await act(async () => onChange(previews));
    };
    return unsubscribe;
  });
});

async function openPicker() {
  const router = await renderRouter('./app', { initialUrl: '/visits/v1/picker' });
  await screen.findByRole('tab', { name: strings.picker.tab.hair });
  return router;
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

function chooseButton() {
  return screen.getByRole('button', { name: strings.picker.choose });
}

async function showTab(dimension: 'hair' | 'beard') {
  await fireEvent.press(screen.getByRole('tab', { name: strings.picker.tab[dimension] }));
}

describe('picker grid', () => {
  it('shows every style with its reference image and name, then each thumbnail as its preview is done', async () => {
    await openPicker();

    expect(api.subscribeToPreviews).toHaveBeenCalledWith('v1', expect.any(Function));
    expect(screen.getByText('Ana Souza')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: strings.picker.tab.hair })).toBeSelected();

    // The keep tile comes first and shows the front photo.
    const names = screen.getAllByRole('button').map((element) => element.props.accessibilityLabel);
    expect(names.filter((name) => name === strings.picker.tile.keep || HAIR_STYLES.includes(name))).toEqual([
      strings.picker.tile.keep,
      ...HAIR_STYLES,
    ]);
    expect(tileImage(strings.picker.tile.keep)).toHaveProp('source', { uri: FRONT_URL });
    expect(tileImage('Degradê baixo')).toHaveProp('source', { uri: 'https://styles.test/hair/low-fade.png' });
    expect(tileImage('Topete')).toHaveProp('source', { uri: 'https://styles.test/hair/quiff.png' });
    for (const name of HAIR_STYLES) {
      expect(within(tile(name)).getByText(name)).toBeOnTheScreen();
      expect(within(tile(name)).getByText(strings.picker.tile.generating)).toBeOnTheScreen();
    }
    expect(within(tile(strings.picker.tile.keep)).queryByText(strings.picker.tile.generating)).toBeNull();

    await emit([previewOf('low-fade', 'running'), previewOf('buzz-cut', 'pending')]);
    expect(tileImage('Degradê baixo')).toHaveProp('source', { uri: 'https://styles.test/hair/low-fade.png' });

    await emit([previewOf('low-fade', 'done'), previewOf('buzz-cut', 'pending')]);

    expect(tileImage('Degradê baixo')).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.thumb.jpg' });
    expect(within(tile('Degradê baixo')).queryByText(strings.picker.tile.generating)).toBeNull();
    expect(within(tile('Máquina')).getByText(strings.picker.tile.generating)).toBeOnTheScreen();
    expect(tileImage('Máquina')).toHaveProp('source', { uri: 'https://styles.test/hair/buzz-cut.png' });

    await showTab('beard');

    expect(screen.getByRole('tab', { name: strings.picker.tab.beard })).toBeSelected();
    expect(screen.queryByRole('button', { name: 'Degradê baixo' })).toBeNull();
    expect(tileImage(strings.picker.tile.keep)).toHaveProp('source', { uri: FRONT_URL });
    expect(tileImage('Barba por fazer')).toHaveProp('source', { uri: 'https://styles.test/beard/stubble.png' });
    expect(tileImage('Cavanhaque')).toHaveProp('source', { uri: 'https://styles.test/beard/goatee.png' });

    await emit([previewOf('low-fade', 'done'), previewOf('buzz-cut', 'pending'), previewOf('goatee', 'done')]);

    expect(tileImage('Cavanhaque')).toHaveProp('source', { uri: 'https://previews.test/pv-goatee.thumb.jpg' });
    expect(within(tile('Barba por fazer')).getByText(strings.picker.tile.generating)).toBeOnTheScreen();
    for (const name of BEARD_STYLES) expect(within(tile(name)).getByText(name)).toBeOnTheScreen();
  });

  it('retries a failed tile on a tap, and leaves a refused tile inert', async () => {
    jest.mocked(api.retryPreview).mockResolvedValue(previewOf('low-fade', 'pending'));
    await openPicker();
    await emit([previewOf('low-fade', 'failed'), previewOf('quiff', 'refused')]);

    expect(within(tile('Degradê baixo')).getByText(strings.picker.tile.failed)).toBeOnTheScreen();
    expect(within(tile('Topete')).getByText(strings.picker.tile.refused)).toBeOnTheScreen();
    expect(tile('Topete')).toBeDisabled();

    await fireEvent.press(tile('Topete'));

    expect(api.retryPreview).not.toHaveBeenCalled();
    expect(tile('Topete')).not.toBeSelected();
    expect(tile(strings.picker.tile.keep)).toBeSelected();

    await fireEvent.press(tile('Degradê baixo'));

    expect(api.retryPreview).toHaveBeenCalledWith('pv-low-fade');
    expect(await within(tile('Degradê baixo')).findByText(strings.picker.tile.generating)).toBeOnTheScreen();
    expect(tile('Degradê baixo')).not.toBeSelected();
  });

  it('chooses hair keep with beard keep with no preview, and goes on to finish', async () => {
    jest.mocked(api.chooseLook).mockResolvedValue(openVisit());
    const router = await openPicker();

    expect(tile(strings.picker.tile.keep)).toBeSelected();
    expect(lookImage()).toHaveProp('source', { uri: FRONT_URL });

    await fireEvent.press(chooseButton());

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-keep',
      beardStyleId: 'beard-keep',
      previewId: null,
    });
    expect(await screen.findByText(strings.finish.title)).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/visits/v1/finish');
  });

  it('shows the selected hair preview large and chooses it with its preview id', async () => {
    jest.mocked(api.chooseLook).mockResolvedValue(openVisit());
    const router = await openPicker();
    await emit([previewOf('low-fade', 'pending')]);

    await fireEvent.press(tile('Degradê baixo'));

    // Selected while it fills in: the reference shows, and it cannot be chosen yet.
    expect(tile('Degradê baixo')).toBeSelected();
    expect(tile(strings.picker.tile.keep)).not.toBeSelected();
    expect(lookImage()).toHaveProp('source', { uri: 'https://styles.test/hair/low-fade.png' });
    expect(chooseButton()).toBeDisabled();

    await emit([previewOf('low-fade', 'done')]);

    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-low-fade.jpg' });
    await waitFor(() => expect(chooseButton()).toBeEnabled());

    await fireEvent.press(chooseButton());

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-low-fade',
      beardStyleId: 'beard-keep',
      previewId: 'pv-low-fade',
    });
    await waitFor(() => expect(router.getPathname()).toBe('/visits/v1/finish'));
  });

  it('chooses a beard with hair kept, with the beard preview id', async () => {
    jest.mocked(api.chooseLook).mockResolvedValue(openVisit());
    await openPicker();
    await emit([previewOf('goatee', 'done')]);

    await showTab('beard');
    await fireEvent.press(tile('Cavanhaque'));

    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-goatee.jpg' });
    await fireEvent.press(chooseButton());

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-keep',
      beardStyleId: 'beard-goatee',
      previewId: 'pv-goatee',
    });
  });

  it('opens on the chosen look, marked on the tabs, and lets it be changed', async () => {
    jest
      .mocked(api.getVisit)
      .mockResolvedValue(
        openVisit({ chosenHairStyleId: 'hair-buzz-cut', chosenBeardStyleId: 'beard-keep', chosenPreviewId: 'pv-buzz-cut' }),
      );
    jest.mocked(api.chooseLook).mockResolvedValue(openVisit());
    await openPicker();
    await emit([previewOf('buzz-cut', 'done'), previewOf('quiff', 'done')]);

    expect(await screen.findByRole('button', { name: strings.picker.chosen })).toBeDisabled();
    expect(tile('Máquina')).toBeSelected();
    expect(tile(strings.picker.tile.keep)).not.toBeSelected();
    expect(lookImage()).toHaveProp('source', { uri: 'https://previews.test/pv-buzz-cut.jpg' });

    await fireEvent.press(tile('Topete'));

    expect(tile('Topete')).toBeSelected();
    expect(screen.queryByRole('button', { name: strings.picker.chosen })).toBeNull();
    await fireEvent.press(chooseButton());

    expect(api.chooseLook).toHaveBeenCalledWith('v1', {
      hairStyleId: 'hair-quiff',
      beardStyleId: 'beard-keep',
      previewId: 'pv-quiff',
    });
  });

  it('says so when the choice cannot be saved, and stays on the picker', async () => {
    jest.mocked(api.chooseLook).mockRejectedValue(new Error('network down'));
    const router = await openPicker();

    await fireEvent.press(chooseButton());

    expect(await screen.findByText(strings.picker.chooseError)).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/visits/v1/picker');
  });

  it('goes back to the visit photos and stops listening to the previews', async () => {
    const router = await openPicker();

    await fireEvent.press(screen.getByRole('button', { name: strings.picker.a11y.back }));

    await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
    expect(router.getPathname()).toBe('/visits/v1/photos');
  });
});
