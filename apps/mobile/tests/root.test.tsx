import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { strings } from '@/lib/strings';

describe('root screen', () => {
  it('opens on the placeholder in Brazilian Portuguese', async () => {
    // The real route tree; the package's test script runs from apps/mobile.
    await renderRouter('./app', { initialUrl: '/' });

    expect(screen.getByText(strings.root.tagline)).toBeOnTheScreen();
    expect(strings.root.tagline).toBe('Prévias de corte na cadeira, em segundos.');
  });
});
