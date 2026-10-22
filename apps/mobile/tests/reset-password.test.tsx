import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { strings } from '@/lib/strings';
import { rafa } from './support/fixtures';

beforeEach(() => {
  jest.mocked(api.getCurrentBarber).mockResolvedValue(null);
  jest.mocked(api.listRecentVisits).mockResolvedValue([]);
  jest.mocked(api.listOpenVisitsToday).mockResolvedValue([]);
});

describe('password reset', () => {
  it('requests a reset link for the email typed on the login screen', async () => {
    jest.mocked(api.requestPasswordReset).mockResolvedValue();
    await renderRouter('./app', { initialUrl: '/' });

    await fireEvent.press(await screen.findByRole('link', { name: strings.login.forgotPassword }));
    await fireEvent.changeText(await screen.findByLabelText(strings.forgotPassword.email), 'rafa@example.com');
    await fireEvent.press(screen.getByRole('button', { name: strings.forgotPassword.submit }));

    expect(api.requestPasswordReset).toHaveBeenCalledWith('rafa@example.com');
    expect(await screen.findByText(strings.forgotPassword.sent)).toBeOnTheScreen();
  });

  it('opens the deep link on set-new-password and saves the new password', async () => {
    jest.mocked(api.openPasswordResetLink).mockResolvedValue(true);
    jest.mocked(api.setNewPassword).mockResolvedValue({ ok: true, barber: rafa });
    // What `barber://reset-password?code=…` resolves to.
    await renderRouter('./app', { initialUrl: '/reset-password?code=pkce-code-123' });

    await fireEvent.changeText(await screen.findByLabelText(strings.resetPassword.password), 'nova-senha');
    await fireEvent.changeText(screen.getByLabelText(strings.resetPassword.confirm), 'nova-senha');
    await fireEvent.press(screen.getByRole('button', { name: strings.resetPassword.submit }));

    expect(api.openPasswordResetLink).toHaveBeenCalledWith('pkce-code-123');
    expect(api.setNewPassword).toHaveBeenCalledWith('nova-senha');
    expect(await screen.findByText(strings.home.recentVisits)).toBeOnTheScreen();
  });

  it('does not save two different passwords', async () => {
    jest.mocked(api.openPasswordResetLink).mockResolvedValue(true);
    await renderRouter('./app', { initialUrl: '/reset-password?code=pkce-code-123' });

    await fireEvent.changeText(await screen.findByLabelText(strings.resetPassword.password), 'nova-senha');
    await fireEvent.changeText(screen.getByLabelText(strings.resetPassword.confirm), 'outra-senha');
    await fireEvent.press(screen.getByRole('button', { name: strings.resetPassword.submit }));

    expect(await screen.findByText('As senhas não são iguais.')).toBeOnTheScreen();
    expect(api.setNewPassword).not.toHaveBeenCalled();
  });

  it('offers a new link when the deep link has expired', async () => {
    jest.mocked(api.openPasswordResetLink).mockResolvedValue(false);
    await renderRouter('./app', { initialUrl: '/reset-password?code=used-code' });

    expect(await screen.findByText('Este link expirou ou já foi usado. Peça um novo.')).toBeOnTheScreen();
    expect(screen.queryByLabelText(strings.resetPassword.password)).not.toBeOnTheScreen();
  });
});
