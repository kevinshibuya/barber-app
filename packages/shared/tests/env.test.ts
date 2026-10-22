import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATE_ENV, MOBILE_ENV, WORKER_ENV } from '../src';

const repoRoot = join(__dirname, '..', '..', '..');

function exampleEnvNames(app: string): string[] {
  return readFileSync(join(repoRoot, 'apps', app, '.env.example'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split('=')[0] ?? '')
    .sort();
}

describe('environment variable names', () => {
  it('lists every mobile name in the mobile example env file, and nothing else', () => {
    expect(exampleEnvNames('mobile')).toEqual([
      'EXPO_PUBLIC_CLIENT_PAGE_BASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]);
    expect(Object.values(MOBILE_ENV).sort()).toEqual(exampleEnvNames('mobile'));
  });

  it('lists every worker name in the worker example env file, and nothing else', () => {
    expect(exampleEnvNames('worker')).toEqual([
      'CLIENT_PAGE_BASE_URL',
      'DATABASE_URL',
      'FAL_KEY',
      'GEMINI_API_KEY',
      'IMAGE_PROVIDER',
      'PORT',
      'PREVIEW_CONCURRENCY',
      'PREVIEW_STALE_TIMEOUT_SECONDS',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_URL',
    ]);
    expect(Object.values(WORKER_ENV).sort()).toEqual(exampleEnvNames('worker'));
  });

  it('has db-test.sh export every name a database test reads', () => {
    const script = readFileSync(join(repoRoot, 'scripts', 'db-test.sh'), 'utf8');
    for (const name of Object.values(GATE_ENV)) {
      expect(script).toMatch(new RegExp(`export ${name}=`));
    }
  });
});
