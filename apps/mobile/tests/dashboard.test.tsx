import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type { Barber } from '@barber/shared';
import * as api from '@/api';
import { strings } from '@/lib/strings';
import { rafa } from './support/fixtures';

const teo: Barber = { ...rafa, id: 'b2', displayName: 'Téo', role: 'barber' };

const dashboard: api.Dashboard = {
  visitsThisWeek: 7,
  visitsThisMonth: 31,
  visitsPerBarber: [
    { barberId: 'b2', displayName: 'Téo', visits: 19 },
    { barberId: 'b1', displayName: 'Rafa', visits: 12 },
    { barberId: 'b3', displayName: 'Duda', visits: 0 },
  ],
  topHairStyles: [
    { styleId: 'h1', name: 'Degradê médio', visits: 9 },
    { styleId: 'h2', name: 'Social', visits: 6 },
    { styleId: 'h3', name: 'Topete', visits: 5 },
    { styleId: 'h4', name: 'Militar', visits: 4 },
    { styleId: 'h5', name: 'Crop texturizado', visits: 2 },
  ],
  topBeardStyles: [
    { styleId: 'b1', name: 'Barba cheia', visits: 8 },
    { styleId: 'b2', name: 'Cavanhaque', visits: 3 },
    { styleId: 'b3', name: 'Por fazer', visits: 1 },
  ],
  returningClientShare: 0.375,
  totalClients: 64,
};

beforeEach(() => {
  jest.mocked(api.listRecentVisits).mockResolvedValue([]);
  jest.mocked(api.listOpenVisitsToday).mockResolvedValue([]);
  jest.mocked(api.getDashboard).mockResolvedValue(dashboard);
});

// A row of the dashboard, a tile or a bar, read the way a screen reader reads it.
function figure(label: string) {
  return within(screen.getByLabelText(label));
}

describe('the owner dashboard', () => {
  it('opens from home for an owner and shows the six numbers and lists', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(rafa);
    await renderRouter('./app', { initialUrl: '/home' });

    await fireEvent.press(await screen.findByRole('button', { name: strings.dashboard.open }));

    await screen.findByText(strings.dashboard.title);
    expect(figure(`${strings.dashboard.visitsThisWeek}: 7`).getByText('7')).toBeOnTheScreen();
    expect(figure(`${strings.dashboard.visitsThisMonth}: 31`).getByText('31')).toBeOnTheScreen();
    expect(figure(`${strings.dashboard.returningClients}: 38%`).getByText('38%')).toBeOnTheScreen();
    expect(figure(`${strings.dashboard.totalClients}: 64`).getByText('64')).toBeOnTheScreen();

    const perBarber = within(screen.getByLabelText(strings.dashboard.visitsPerBarber));
    expect(perBarber.getByLabelText('Téo: 19')).toBeOnTheScreen();
    expect(perBarber.getByLabelText('Rafa: 12')).toBeOnTheScreen();
    expect(perBarber.getByLabelText('Duda: 0')).toBeOnTheScreen();

    const hair = within(screen.getByLabelText(strings.dashboard.topHairStyles));
    for (const [name, visits] of [
      ['Degradê médio', 9],
      ['Social', 6],
      ['Topete', 5],
      ['Militar', 4],
      ['Crop texturizado', 2],
    ]) {
      expect(hair.getByLabelText(`${name}: ${visits}`)).toBeOnTheScreen();
    }

    const beard = within(screen.getByLabelText(strings.dashboard.topBeardStyles));
    expect(beard.getByLabelText('Barba cheia: 8')).toBeOnTheScreen();
    expect(beard.getByLabelText('Cavanhaque: 3')).toBeOnTheScreen();
    expect(beard.getByLabelText('Por fazer: 1')).toBeOnTheScreen();
  });

  it('has no entry on home for a barber', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(teo);
    await renderRouter('./app', { initialUrl: '/home' });

    await screen.findByRole('button', { name: strings.home.signOut });
    await waitFor(() => expect(api.getCurrentBarber).toHaveBeenCalled());
    // Lets home's role check settle before asserting the entry is absent.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: strings.dashboard.open })).not.toBeOnTheScreen();
  });

  it('sends a barber who opens its route back home', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(teo);
    const router = await renderRouter('./app', { initialUrl: '/dashboard' });

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    expect(await screen.findByLabelText(strings.home.search)).toBeOnTheScreen();
    expect(screen.queryByText(strings.dashboard.title)).not.toBeOnTheScreen();
    expect(api.getDashboard).not.toHaveBeenCalled();
  });
});
