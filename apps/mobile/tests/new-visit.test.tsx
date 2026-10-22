import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { strings } from '@/lib/strings';
import { openVisit } from './support/fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  jest.mocked(api.listVisitPhotos).mockResolvedValue([]);
});

describe('new visit', () => {
  it('shows the privacy text and keeps the camera closed until consent is ticked', async () => {
    await renderRouter('./app', { initialUrl: '/clients/c1/new-visit' });

    expect(await screen.findByText(strings.newVisit.privacy)).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: strings.newVisit.consent })).not.toBeChecked();
    expect(screen.getByRole('button', { name: strings.newVisit.takePhotos })).toBeDisabled();
    expect(api.startVisit).not.toHaveBeenCalled();
  });

  it('creates the visit with consent and a device-generated id once consent is ticked, then opens the slots', async () => {
    jest.mocked(api.startVisit).mockImplementation(async ({ id }) => openVisit({ id }));
    const router = await renderRouter('./app', { initialUrl: '/clients/c1/new-visit' });

    await fireEvent.press(await screen.findByRole('checkbox', { name: strings.newVisit.consent }));

    expect(api.startVisit).toHaveBeenCalledTimes(1);
    expect(api.startVisit).toHaveBeenCalledWith({ id: expect.stringMatching(UUID), clientId: 'c1', consentGiven: true });
    const visitId = jest.mocked(api.startVisit).mock.calls[0]![0].id;
    const takePhotos = screen.getByRole('button', { name: strings.newVisit.takePhotos });
    await waitFor(() => expect(takePhotos).toBeEnabled());
    expect(screen.getByRole('checkbox', { name: strings.newVisit.consent })).toBeChecked();

    await fireEvent.press(takePhotos);

    expect(await screen.findByText(strings.photos.title)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/visits/${visitId}/photos`);
  });

  it('unticks consent and keeps the camera closed when the visit cannot be created', async () => {
    jest.mocked(api.startVisit).mockRejectedValue(new Error('network down'));
    await renderRouter('./app', { initialUrl: '/clients/c1/new-visit' });

    await fireEvent.press(await screen.findByRole('checkbox', { name: strings.newVisit.consent }));

    expect(await screen.findByText(strings.newVisit.failed)).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: strings.newVisit.consent })).not.toBeChecked();
    expect(screen.getByRole('button', { name: strings.newVisit.takePhotos })).toBeDisabled();
  });
});
