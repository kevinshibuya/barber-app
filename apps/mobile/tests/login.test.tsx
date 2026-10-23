import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { strings } from '@/lib/strings';
import { rafa } from './support/fixtures';

beforeEach(() => {
  jest.mocked(api.listRecentVisits).mockResolvedValue([]);
  jest.mocked(api.listOpenVisitsToday).mockResolvedValue([]);
});

async function signInWith(email: string, password: string) {
  await fireEvent.changeText(await screen.findByLabelText(strings.login.email), email);
  await fireEvent.changeText(screen.getByLabelText(strings.login.password), password);
  await fireEvent.press(screen.getByRole('button', { name: strings.login.submit }));
}

describe('login', () => {
  it('shows the error in Brazilian Portuguese on a wrong password', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(null);
    jest.mocked(api.signIn).mockResolvedValue({ ok: false, reason: 'wrong-credentials' });
    await renderRouter('./app', { initialUrl: '/' });

    await signInWith('rafa@example.com', 'errada');

    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeOnTheScreen();
    expect(api.signIn).toHaveBeenCalledWith('rafa@example.com', 'errada');
    expect(screen.queryByText(strings.home.recentVisits)).not.toBeOnTheScreen();
  });

  it('lands on home with the right password', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(null);
    jest.mocked(api.signIn).mockResolvedValue({ ok: true, barber: rafa });
    await renderRouter('./app', { initialUrl: '/' });

    await signInWith('rafa@example.com', 'certa');

    expect(await screen.findByText(strings.home.recentVisits)).toBeOnTheScreen();
    expect(screen.queryByLabelText(strings.login.password)).not.toBeOnTheScreen();
  });

  it('lands on home without the login screen when a session is stored', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(rafa);
    await renderRouter('./app', { initialUrl: '/' });

    expect(await screen.findByText(strings.home.recentVisits)).toBeOnTheScreen();
    expect(screen.queryByLabelText(strings.login.password)).not.toBeOnTheScreen();
    expect(api.signIn).not.toHaveBeenCalled();
  });
});
