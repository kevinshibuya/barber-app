import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { strings } from '@/lib/strings';
import { client, rafa, visit } from './support/fixtures';

beforeEach(() => {
  jest.mocked(api.getCurrentBarber).mockResolvedValue(rafa);
  jest.mocked(api.listOpenVisitsToday).mockResolvedValue([]);
});

describe('home', () => {
  it('lists the shop recent visits with client, barber, date and thumbnails', async () => {
    jest.mocked(api.listRecentVisits).mockResolvedValue([
      visit({
        id: 'v2',
        clientName: 'Bruno Lima',
        barberName: 'Téo',
        createdAt: '2026-10-21T14:00:00.000Z',
        lookThumbnailUrl: 'https://storage.test/look-v2.jpg',
        afterPhotoUrl: 'https://storage.test/after-v2.jpg',
      }),
      visit({
        id: 'v1',
        clientName: 'Ana Souza',
        barberName: 'Rafa',
        createdAt: '2026-10-20T15:00:00.000Z',
        lookThumbnailUrl: 'https://storage.test/look-v1.jpg',
        afterPhotoUrl: null,
      }),
    ]);
    await renderRouter('./app', { initialUrl: '/' });

    const bruno = within(await screen.findByLabelText('Bruno Lima, 21/10/2026'));
    expect(bruno.getByText('com Téo')).toBeOnTheScreen();
    expect(bruno.getByLabelText(strings.visit.look)).toHaveProp('source', { uri: 'https://storage.test/look-v2.jpg' });
    expect(bruno.getByLabelText(strings.visit.after)).toHaveProp('source', { uri: 'https://storage.test/after-v2.jpg' });

    const ana = within(screen.getByLabelText('Ana Souza, 20/10/2026'));
    expect(ana.getByText('com Rafa')).toBeOnTheScreen();
    expect(ana.getByLabelText(strings.visit.look)).toHaveProp('source', { uri: 'https://storage.test/look-v1.jpg' });
    expect(ana.queryByLabelText(strings.visit.after)).not.toBeOnTheScreen();
  });

  it('searches clients by the two letters typed and lists them', async () => {
    jest.mocked(api.listRecentVisits).mockResolvedValue([]);
    jest.mocked(api.searchClients).mockResolvedValue([
      client({ id: 'c1', name: 'Ana Souza' }),
      client({ id: 'c2', name: 'Mariana Costa' }),
    ]);
    await renderRouter('./app', { initialUrl: '/' });

    await fireEvent.changeText(await screen.findByLabelText(strings.home.search), 'an');

    expect(await screen.findByText('Mariana Costa')).toBeOnTheScreen();
    expect(screen.getByText('Ana Souza')).toBeOnTheScreen();
    expect(api.searchClients).toHaveBeenLastCalledWith('an', expect.any(Function));
  });
});
