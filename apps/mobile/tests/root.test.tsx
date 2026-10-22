import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import { strings } from '@/lib/strings';

describe('root screen', () => {
  it('opens in Brazilian Portuguese', async () => {
    jest.mocked(api.getCurrentBarber).mockResolvedValue(null);
    // The real route tree; the package's test script runs from apps/mobile.
    await renderRouter('./app', { initialUrl: '/' });

    expect(await screen.findByText(strings.root.tagline)).toBeOnTheScreen();
    expect(strings.root.tagline).toBe('Prévias de corte na cadeira, em segundos.');
  });
});
