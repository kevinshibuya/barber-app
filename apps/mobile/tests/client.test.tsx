import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { strings } from '@/lib/strings';
import { client, rafa, visit } from './support/fixtures';

beforeEach(() => {
  jest.mocked(api.getCurrentBarber).mockResolvedValue(rafa);
  jest.mocked(api.listRecentVisits).mockResolvedValue([]);
});

describe('clients', () => {
  it('creates a client with a name and no phone and opens their screen', async () => {
    const created = client({ id: 'c9', name: 'Caio Prado', phone: null });
    jest.mocked(api.createClient).mockResolvedValue(created);
    jest.mocked(api.getClient).mockResolvedValue(created);
    jest.mocked(api.listClientVisits).mockResolvedValue([]);
    await renderRouter('./app', { initialUrl: '/' });

    await fireEvent.press(await screen.findByRole('button', { name: strings.home.newClient }));
    await fireEvent.changeText(await screen.findByLabelText(strings.newClient.name), 'Caio Prado');
    await fireEvent.press(screen.getByRole('button', { name: strings.newClient.submit }));

    expect(api.createClient).toHaveBeenCalledWith({ name: 'Caio Prado', phone: null });
    expect(await screen.findByText(strings.client.noVisits)).toBeOnTheScreen();
    expect(screen.getByText('Caio Prado')).toBeOnTheScreen();
    expect(screen.getByText(strings.client.noPhone)).toBeOnTheScreen();
    expect(api.getClient).toHaveBeenCalledWith('c9');
  });

  it('does not create a client without a name', async () => {
    await renderRouter('./app', { initialUrl: '/clients/new' });

    await fireEvent.changeText(await screen.findByLabelText(strings.newClient.name), '   ');
    await fireEvent.press(screen.getByRole('button', { name: strings.newClient.submit }));

    expect(await screen.findByText('Informe o nome do cliente.')).toBeOnTheScreen();
    expect(api.createClient).not.toHaveBeenCalled();
  });

  it('lists the client visits newest first, with the barber and thumbnails', async () => {
    jest.mocked(api.getClient).mockResolvedValue(client({ id: 'c1', name: 'Ana Souza', phone: '11 98888-7777' }));
    jest.mocked(api.listClientVisits).mockResolvedValue([
      visit({ id: 'v1', createdAt: '2026-08-12T15:00:00.000Z', barberName: 'Rafa', afterPhotoUrl: 'https://storage.test/after-v1.jpg' }),
      visit({
        id: 'v3',
        createdAt: '2026-10-14T15:00:00.000Z',
        barberName: 'Téo',
        lookThumbnailUrl: 'https://storage.test/look-v3.jpg',
        afterPhotoUrl: 'https://storage.test/after-v3.jpg',
      }),
      visit({ id: 'v2', createdAt: '2026-09-10T15:00:00.000Z', barberName: 'Rafa' }),
    ]);
    await renderRouter('./app', { initialUrl: '/clients/c1' });

    expect(await screen.findByText('11 98888-7777')).toBeOnTheScreen();
    expect(screen.getByText('Ana Souza')).toBeOnTheScreen();
    const rows = screen.getAllByLabelText(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(['14/10/2026', '10/09/2026', '12/08/2026']);

    const latest = within(screen.getByLabelText('14/10/2026'));
    expect(latest.getByText('com Téo')).toBeOnTheScreen();
    expect(latest.getByLabelText(strings.visit.look)).toHaveProp('source', { uri: 'https://storage.test/look-v3.jpg' });
    expect(latest.getByLabelText(strings.visit.after)).toHaveProp('source', { uri: 'https://storage.test/after-v3.jpg' });
    const oldest = within(screen.getByLabelText('12/08/2026'));
    expect(oldest.getByText('com Rafa')).toBeOnTheScreen();
    expect(oldest.queryByLabelText(strings.visit.look)).not.toBeOnTheScreen();
    expect(api.listClientVisits).toHaveBeenCalledWith('c1');
  });

  it('routes new visit to its placeholder', async () => {
    jest.mocked(api.getClient).mockResolvedValue(client({ id: 'c1' }));
    jest.mocked(api.listClientVisits).mockResolvedValue([]);
    await renderRouter('./app', { initialUrl: '/clients/c1' });

    await fireEvent.press(await screen.findByRole('button', { name: strings.client.newVisit }));

    expect(await screen.findByText(strings.newVisit.comingSoon)).toBeOnTheScreen();
  });
});
